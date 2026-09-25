import { DEEPSEEK_BASE_URL, type ExtensionSettings } from "../types.js";
import { abortMessage, sleep, TIMEOUT_MESSAGE } from "./util.js";
import prompt from "./prompts/tech-translate.md?raw";

const MAX_GROUP_CHARS = 4500;
const MAX_GROUP_UNITS = 12;
const CJK = /[㐀-鿿]/;

function splitFrontmatter(src: string): { frontmatter: string; body: string } {
  if (!src.startsWith("---")) return { frontmatter: "", body: src };
  const end = src.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: src };
  return {
    frontmatter: src.slice(0, end + 4).trimEnd() + "\n\n",
    body: src.slice(end + 4).replace(/^\s+/, ""),
  };
}

function stripModelWrapper(text: string): string {
  let out = text.trim();
  out = out.replace(/^```(?:markdown|md)?\s*\n/i, "").replace(/\n```$/i, "");
  return out.trim() + "\n";
}

function splitIntoUnits(md: string): string[] {
  const lines = md.split("\n");
  const units: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) units.push(text);
    buf = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      buf.push(line);
      if (!inFence) flush();
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return units;
}

function packUnitGroups(units: string[]): string[][] {
  const groups: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const u of units) {
    const next = chars + u.length + 2;
    if (cur.length && (cur.length >= MAX_GROUP_UNITS || next > MAX_GROUP_CHARS)) {
      groups.push(cur);
      cur = [u];
      chars = u.length;
    } else {
      cur.push(u);
      chars = next;
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function isProtectedUnit(unit: string): boolean {
  const t = unit.trim();
  if (/^```/.test(t)) return true;
  if (/^!\[[^\]]*]\([^)]+\)\s*$/.test(t)) return true;
  if (/^<img\b/i.test(t)) return true;
  return false;
}

function parseNumberedBlocks(text: string, expected: number): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = /^<<<(\d+)>>>\s*(.*)$/;
  const found = new Map<number, string[]>();
  let current: number | null = null;
  for (const line of lines) {
    const m = line.match(start);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= expected) {
        current = n;
        found.set(n, []);
        if (m[2]?.trim()) found.get(n)!.push(m[2]);
        continue;
      }
    }
    if (current != null) found.get(current)!.push(line);
  }
  const out: string[] = [];
  for (let i = 1; i <= expected; i++) {
    const body = (found.get(i) || []).join("\n").trim();
    if (!body) throw new Error(`译文缺块 ${i}/${expected}`);
    out.push(body);
  }
  return out;
}

function looksTranslated(original: string, zh: string): boolean {
  if (!zh.trim()) return false;
  if (original.trim().length < 24) return true;
  return CJK.test(zh);
}

function extractStyleAnchors(translated: string): string[] {
  const paras = translated
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => CJK.test(p) && p.length > 20 && p.length < 280);
  const colloquial = paras.find((p) => /说白了|举个例子|换句话说|其实/.test(p));
  const term = paras.find((p) => /（[^）]{4,40}）/.test(p) && p !== colloquial);
  const transition = paras.find((p) => /下面|接下来|那他们|上面讲的/.test(p) && p !== colloquial && p !== term);
  return [colloquial, term, transition].filter((p): p is string => Boolean(p)).slice(0, 3);
}

function assembleBilingual(units: string[], zhByUnit: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < units.length; i++) {
    parts.push(units[i]);
    const zh = zhByUnit[i]?.trim();
    if (zh) parts.push(zh);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function stripLeadingFrontmatter(text: string): string {
  let t = text.trim();
  const fenced = t.match(/^```(?:ya?ml)?[ \t]*\n([\s\S]*?)\n```[ \t]*\n?/i);
  if (fenced && /^---/.test(fenced[1].trim()) && /:\s*["']?/.test(fenced[1])) {
    t = t.slice(fenced[0].length).replace(/^\s+/, "");
  }
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end !== -1 && /:\s*["']?/.test(t.slice(3, end))) {
      t = t.slice(end + 4).replace(/^\s+/, "");
    }
  }
  return t;
}

async function chat(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  signal?: AbortSignal,
  onActivity?: () => void,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal?.aborted) throw new Error(abortMessage(signal));
    onActivity?.();
    try {
      const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model,
          temperature: 0.4,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          thinking: { type: "disabled" },
        }),
      });
      if (!res.ok) {
        const err = new Error(`DeepSeek 请求失败 (${res.status})`);
        (err as { status?: number }).status = res.status;
        throw err;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content;
      if (!text?.trim()) throw new Error("模型返回空内容");
      return stripModelWrapper(text);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        throw new Error(signal ? abortMessage(signal) : TIMEOUT_MESSAGE);
      }
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status && status !== 429 && status < 500) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("翻译请求失败");
}

function buildUserPrompt(jobs: { u: string }[], anchors: string[]): string {
  const extra = anchors.length
    ? `\n风格参考（保持同样口语）：\n${anchors.map((a, n) => `${n + 1}. ${a}`).join("\n")}\n`
    : "";
  return `下面有 ${jobs.length} 个英文 Markdown 块。请逐块译成简体中文。
规则：
- 用 <<<编号>>> 单独一行作为每块开头，编号从 1 到 ${jobs.length}，一块都不能少
- 每个块只写中文译文，不要重复英文原文，不要输出图片 markdown
- 保留该块原有 Markdown 结构（# 级别、列表符号、链接 URL、加粗）
- 不要把两块合成一块，也不要把一块拆成两个编号
- 不要开场白、不要总结、不要 YAML
${extra}
${jobs.map((x, n) => `<<<${n + 1}>>>\n${x.u}`).join("\n\n")}
`;
}

async function translateUnitGroup(
  units: string[],
  settings: ExtensionSettings,
  signal: AbortSignal | undefined,
  onActivity: (() => void) | undefined,
  anchors: string[],
  depth = 0,
): Promise<string[]> {
  const zhOut = units.map(() => "");
  const jobs = units.map((u, i) => ({ u, i })).filter((x) => !isProtectedUnit(x.u));
  if (jobs.length === 0) return zhOut;

  const user = buildUserPrompt(jobs, anchors);
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log("[p2r][translate] 请求组 块数=", jobs.length, "depth=", depth, "attempt=", attempt + 1);
      const raw = stripLeadingFrontmatter(
        await chat(settings.apiKey, settings.model, prompt, user, signal, onActivity),
      );
      const parsed = parseNumberedBlocks(raw, jobs.length);
      for (let n = 0; n < jobs.length; n++) {
        if (!looksTranslated(jobs[n].u, parsed[n])) {
          throw new Error(`第 ${n + 1} 块不像中文译文`);
        }
        zhOut[jobs[n].i] = parsed[n];
      }
      return zhOut;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.log("[p2r][translate] 分组失败，将重试:", lastErr.message);
    }
  }

  if (units.length > 1 && depth < 4) {
    const mid = Math.ceil(units.length / 2);
    console.log("[p2r][translate] 对半拆分", units.length, "->", mid, "+", units.length - mid);
    const a = await translateUnitGroup(units.slice(0, mid), settings, signal, onActivity, anchors, depth + 1);
    const b = await translateUnitGroup(units.slice(mid), settings, signal, onActivity, anchors, depth + 1);
    return [...a, ...b];
  }

  throw lastErr ?? new Error("翻译分组失败");
}

export async function translateBilingual(
  originalMarkdown: string,
  settings: ExtensionSettings,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  onActivity?: () => void,
): Promise<string> {
  if (!settings.apiKey) throw new Error("未配置 DeepSeek API Key");
  const { frontmatter, body } = splitFrontmatter(originalMarkdown);

  const units = splitIntoUnits(body);
  const groups = packUnitGroups(units);
  console.log(
    "[p2r][translate] 对照拼接 块=",
    units.length,
    "组=",
    groups.length,
    "字符=",
    body.length,
  );

  const zhByUnit: string[] = [];
  let anchors: string[] = [];
  onProgress?.(0, groups.length);

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const zh = await translateUnitGroup(group, settings, signal, onActivity, anchors);
    zhByUnit.push(...zh);
    onProgress?.(g + 1, groups.length);
    const joinedZh = zh.filter(Boolean).join("\n\n");
    if (joinedZh) {
      const next = extractStyleAnchors(joinedZh);
      if (next.length) anchors = next;
    }
  }

  if (zhByUnit.length !== units.length) {
    throw new Error("中英对照拼接失败：译文块数与原文不一致");
  }

  const merged = assembleBilingual(units, zhByUnit);
  const zhChars = (merged.match(/[㐀-鿿]/g) || []).length;
  const latinChars = (merged.match(/[A-Za-z]/g) || []).length;
  console.log("[p2r][translate] 拼接完成 CJK=", zhChars, "Latin=", latinChars);
  if (body.replace(/\s/g, "").length > 200 && (latinChars < 80 || zhChars < 80)) {
    throw new Error("中英对照校验失败：译文缺少原文或中文");
  }
  return frontmatter + merged;
}
