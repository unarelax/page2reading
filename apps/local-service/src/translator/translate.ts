import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { AppConfig } from "../config.js";
import { sleep } from "../util.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LONG_DOC_LINES = 500;
const CHAPTERS_PER_CHUNK = 2;

function loadPrompt(): string {
  const candidates = [
    join(__dirname, "../../../../prompts/tech-translate.md"),
    join(process.cwd(), "prompts/tech-translate.md"),
  ];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error("找不到 prompts/tech-translate.md");
}

function splitFrontmatter(src: string): { frontmatter: string; body: string } {
  if (!src.startsWith("---")) return { frontmatter: "", body: src };
  const end = src.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: src };
  return {
    frontmatter: src.slice(0, end + 4).trimEnd() + "\n\n",
    body: src.slice(end + 4).replace(/^\s+/, ""),
  };
}

function countLines(text: string): number {
  return text.split("\n").length;
}

function extractImageUrls(md: string): string[] {
  const urls = new Set<string>();
  for (const match of md.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) urls.add(match[1]);
  for (const match of md.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(match[1]);
  return [...urls].sort();
}

function countFences(md: string): number {
  return (md.match(/^```/gm) || []).length;
}

function stripModelWrapper(text: string): string {
  let out = text.trim();
  out = out.replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```$/i, "");
  return out.trim() + "\n";
}

function splitByChapters(body: string): string[] {
  const lines = body.split("\n");
  const headingIdx: number[] = [];
  lines.forEach((line, i) => {
    if (/^##\s+/.test(line)) headingIdx.push(i);
  });
  if (headingIdx.length <= 1) return [body];

  const preamble = lines.slice(0, headingIdx[0]).join("\n").trim();
  const chunks: string[] = [];
  for (let i = 0; i < headingIdx.length; i += CHAPTERS_PER_CHUNK) {
    const start = headingIdx[i];
    const end = i + CHAPTERS_PER_CHUNK < headingIdx.length ? headingIdx[i + CHAPTERS_PER_CHUNK] : lines.length;
    const slice = lines.slice(start, end).join("\n").trim();
    chunks.push(i === 0 && preamble ? `${preamble}\n\n${slice}` : slice);
  }
  return chunks.filter(Boolean);
}

function extractStyleAnchors(translated: string): string[] {
  const paras = translated
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => /[\u4e00-\u9fff]/.test(p) && p.length > 20 && p.length < 280);
  const colloquial = paras.find((p) => /说白了|举个例子|换句话说|其实/.test(p));
  const term = paras.find((p) => /（[^）]{4,40}）/.test(p) && p !== colloquial);
  const transition = paras.find((p) => /下面|接下来|那他们|上面讲的/.test(p) && p !== colloquial && p !== term);
  return [colloquial, term, transition].filter((p): p is string => Boolean(p)).slice(0, 3);
}

async function chat(client: OpenAI, model: string, system: string, user: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // DeepSeek V4.1 Flash: disable thinking to keep translation fast and cheap
        // @ts-expect-error OpenAI SDK extra body
        extra_body: { thinking: { type: "disabled" } },
      });
      const text = res.choices[0]?.message?.content;
      if (!text?.trim()) throw new Error("模型返回空内容");
      return stripModelWrapper(text);
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status && status !== 429 && status < 500) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("翻译请求失败");
}

function validateTranslation(originalBody: string, translated: string): string[] {
  const errors: string[] = [];
  if (translated.trim().length < originalBody.trim().length * 0.5) {
    errors.push("译文明显短于原文，可能被截断");
  }
  const origFences = countFences(originalBody);
  const transFences = countFences(translated);
  if (origFences !== transFences) {
    errors.push(`代码块围栏数量不一致：原文 ${origFences} / 译文 ${transFences}`);
  }
  const origImages = extractImageUrls(originalBody);
  const transImages = new Set(extractImageUrls(translated));
  const missing = origImages.filter((u) => !transImages.has(u));
  if (missing.length) errors.push(`图片 URL 丢失：${missing.slice(0, 3).join(", ")}`);
  if (/<!--APPEND-->/.test(translated)) errors.push("译文含未清理哨兵");
  return errors;
}

export async function translateBilingual(originalMarkdown: string, config: AppConfig): Promise<string> {
  if (!config.deepseekApiKey) throw new Error("未配置 DEEPSEEK_API_KEY");
  const prompt = loadPrompt();
  const { frontmatter, body } = splitFrontmatter(originalMarkdown);
  const client = new OpenAI({
    apiKey: config.deepseekApiKey,
    baseURL: config.deepseekBaseUrl,
  });

  const chunks =
    countLines(body) > LONG_DOC_LINES && /^##\s+/m.test(body) ? splitByChapters(body) : [body];

  const parts: string[] = [];
  let anchors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const extra =
      i > 0 && anchors.length
        ? `\n\n以下是前一段译文里抽出的风格锚点，请保持同样的口语讲解风：\n${anchors
            .map((a, n) => `${n + 1}. ${a}`)
            .join("\n")}\n`
        : "";
    const user =
      chunks.length === 1
        ? `请把下面整篇英文 Markdown 翻成段落级中英对照。YAML frontmatter 原样放在最顶部。\n\n${originalMarkdown}`
        : `这是长文的第 ${i + 1}/${chunks.length} 段。只翻译这一段，不要重复其他段。${
            i === 0 ? "先输出 YAML frontmatter（原样），再输出本段对照正文。" : "不要输出 frontmatter。"
          }${extra}\n\n${i === 0 ? frontmatter : ""}${chunk}`;

    let translated = await chat(client, config.deepseekModel, prompt, user);
    if (i === 0) {
      if (!translated.startsWith("---") && frontmatter) translated = frontmatter + translated;
      anchors = extractStyleAnchors(translated);
    } else if (translated.startsWith("---")) {
      const split = splitFrontmatter(translated);
      translated = split.body;
    }
    parts.push(translated.trim());
  }

  const merged = parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
  const errors = validateTranslation(body, splitFrontmatter(merged).body);
  if (errors.length) {
    const repaired = await chat(
      client,
      config.deepseekModel,
      prompt,
      `下面这篇中英对照译文未通过校验：${errors.join("；")}。请在不改变翻译风格的前提下修复，并输出完整修正后的 Markdown（含 frontmatter）。\n\n原文：\n${originalMarkdown}\n\n当前译文：\n${merged}`,
    );
    const repairedErrors = validateTranslation(body, splitFrontmatter(repaired).body);
    if (repairedErrors.length === 0) return repaired.startsWith("---") ? repaired : frontmatter + repaired;
    // keep first merged result but caller may add warnings
  }
  return merged.startsWith("---") ? merged : frontmatter + merged;
}
