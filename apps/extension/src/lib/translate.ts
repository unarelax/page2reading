import { DEEPSEEK_BASE_URL, type ExtensionSettings } from "../types.js";
import { abortMessage, REQUEST_TIMEOUT_MS, sleep, TRANSLATE_MAX_MS } from "./util.js";
import prompt from "./prompts/tech-translate.md?raw";

const MAX_GROUP_CHARS = 4500;
const MAX_GROUP_UNITS = 12;
const MAX_SECTIONS_PER_GROUP = 3;
const CHAT_ATTEMPTS = 2;
const GROUP_ATTEMPTS = 2;
const CJK = /[㐀-鿿]/;
const COLLOQUIAL_RE = /说白了|举个例子|换句话说|其实|具体来说/g;
const STIFF_RE = /赋能|闭环|本质上|鉴于|该模型/g;

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

function isH2(unit: string): boolean {
  return /^##\s/.test(unit.trim());
}

function sectionChars(units: string[]): number {
  return units.reduce((n, u) => n + u.length + 2, 0);
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

/** 按 `##` 章节打包，每组 1–3 节；单节过长再按块切。短文尽量少组。 */
export function packSectionGroups(units: string[]): string[][] {
  const sections: string[][] = [];
  let current: string[] = [];
  for (const u of units) {
    if (isH2(u) && current.length) {
      sections.push(current);
      current = [u];
    } else {
      current.push(u);
    }
  }
  if (current.length) sections.push(current);

  const groups: string[][] = [];
  let bunched: string[] = [];
  let bunchSections = 0;
  let chars = 0;

  const flush = () => {
    if (bunched.length) groups.push(bunched);
    bunched = [];
    bunchSections = 0;
    chars = 0;
  };

  for (const sec of sections) {
    const secLen = sectionChars(sec);
    if (secLen > MAX_GROUP_CHARS) {
      flush();
      groups.push(...packUnitGroups(sec));
      continue;
    }
    if (bunched.length && (bunchSections >= MAX_SECTIONS_PER_GROUP || chars + secLen > MAX_GROUP_CHARS)) {
      flush();
    }
    bunched.push(...sec);
    bunchSections++;
    chars += secLen;
  }
  flush();
  return groups;
}

function isImageUnit(unit: string): boolean {
  const t = unit.trim();
  if (/^!\[[^\]]*]\([^)]+\)\s*$/.test(t)) return true;
  if (/^<img\b/i.test(t)) return true;
  return false;
}

function isProtectedUnit(unit: string): boolean {
  const t = unit.trim();
  if (/^```/.test(t)) return true;
  return isImageUnit(t);
}

function isTableUnit(unit: string): boolean {
  const t = unit.trim();
  if (/<table[\s>]/i.test(t)) return true;
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const row = (s: string) => /^\s*\|.+\|\s*$/.test(s);
  const sep = (s: string) => /^\s*\|?\s*:?-{3,}[-|:\s]*\|?\s*$/.test(s);
  return row(lines[0]) && sep(lines[1]);
}

export function parseNumberedBlocks(text: string, expected: number): string[] {
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

export function looksTranslated(original: string, zh: string): boolean {
  if (!zh.trim()) return false;
  if (isTableUnit(original)) return /\|/.test(zh) || /<table[\s>]/i.test(zh);
  const o = original.trim();
  const z = zh.trim();
  if (z === o) return o.length < 24;
  if (o.length < 24) return true;
  return CJK.test(zh);
}

function countRe(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags)) || []).length;
}

function extractStyleAnchors(translated: string): string[] {
  const paras = translated
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => CJK.test(p) && p.length > 20 && p.length < 280);
  const colloquial = paras.find((p) => /说白了|举个例子|换句话说|其实|具体来说/.test(p));
  const term = paras.find((p) => /（[^）]{4,40}）/.test(p) && p !== colloquial);
  const transition = paras.find(
    (p) => /下面|接下来|上面讲的|换句话说/.test(p) && p !== colloquial && p !== term,
  );
  const labeled: string[] = [];
  if (colloquial) labeled.push(`口语短句：${colloquial}`);
  if (term) labeled.push(`术语解释：${term}`);
  if (transition) labeled.push(`过渡句：${transition}`);
  return labeled.slice(0, 3);
}

function mergeAnchors(current: string[], incoming: string[]): string[] {
  const out = [...current];
  for (const a of incoming) {
    if (out.length >= 3) break;
    const kind = a.split("：")[0];
    if (!out.some((x) => x.startsWith(`${kind}：`))) out.push(a);
  }
  return out;
}

function groupLooksStiff(zhBlocks: string[]): boolean {
  const text = zhBlocks.filter(Boolean).join("\n");
  if (text.replace(/\s/g, "").length < 200) return false;
  const colloquial = countRe(text, COLLOQUIAL_RE);
  const stiff = countRe(text, STIFF_RE);
  return stiff >= 2 && stiff > colloquial;
}

function logStyleConsistency(merged: string): void {
  const paras = merged.split(/\n{2,}/);
  if (paras.length < 8) return;
  const mid = Math.ceil(paras.length / 2);
  const head = countRe(paras.slice(0, mid).join("\n"), COLLOQUIAL_RE);
  const tail = countRe(paras.slice(mid).join("\n"), COLLOQUIAL_RE);
  const max = Math.max(head, tail);
  const min = Math.min(head, tail);
  const drifted = max > 0 && (max - min) / max > 0.2;
  console.log("[p2r][translate] 口语词频 前半=", head, "后半=", tail, drifted ? "漂移" : "稳定");
}

function assembleBilingual(units: string[], zhByUnit: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const zh = zhByUnit[i]?.trim();
    if (isImageUnit(unit) || /^```/.test(unit.trim())) {
      parts.push(unit);
      continue;
    }
    if (isTableUnit(unit)) {
      parts.push(zh || unit);
      continue;
    }
    parts.push(unit);
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

function requestSignal(pipeline?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return pipeline ? AbortSignal.any([pipeline, timeout]) : timeout;
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
  for (let attempt = 0; attempt < CHAT_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error(abortMessage(signal));
    try {
      const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: requestSignal(signal),
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
      onActivity?.();
      return stripModelWrapper(text);
    } catch (err) {
      onActivity?.();
      if (signal?.aborted) {
        throw new Error(abortMessage(signal));
      }
      lastError = err;
      const timedOut =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && /aborted|timeout|The operation was aborted/i.test(err.message));
      const status = (err as { status?: number }).status;
      if (!timedOut && status && status !== 429 && status < 500) throw err;
      console.log("[p2r][translate] 请求失败，将重试:", err instanceof Error ? err.message : err);
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("翻译请求失败");
}

function buildUserPrompt(jobs: { u: string }[], anchors: string[], styleNudge: boolean): string {
  const extra = anchors.length
    ? `\n风格锚点（必须同一口气，不要越译越书面）：\n${anchors.map((a, n) => `${n + 1}. ${a}`).join("\n")}\n`
    : "";
  const nudge = styleNudge
    ? `\n上一版偏书面或把英文原样贴回。标题、导语也必须译成中文；多用「说白了/举个例子/换句话说」，不要用「赋能/闭环/本质上/鉴于」。\n`
    : "";
  return `下面有 ${jobs.length} 个英文 Markdown 块。请逐块译成简体中文。
规则：
- 用 <<<编号>>> 单独一行作为每块开头，编号从 1 到 ${jobs.length}，一块都不能少
- 每个块只写中文译文，不要重复英文原文，不要输出图片 markdown
- 标题、导语也要译成中文，不要把英文原句再贴一遍
- 保留该块原有 Markdown 结构（# 级别、列表符号、链接 URL、加粗）
- 表格块只输出一张中文表，不要把英文表再抄一遍
- 不要把两块合成一块，也不要把一块拆成两个编号
- 不要开场白、不要总结、不要 YAML
${extra}${nudge}
${jobs.map((x, n) => `<<<${n + 1}>>>\n${x.u}`).join("\n\n")}
`;
}

async function fetchParsedBlocks(
  jobs: { u: string; i: number }[],
  settings: ExtensionSettings,
  signal: AbortSignal | undefined,
  anchors: string[],
  styleNudge: boolean,
  onActivity?: () => void,
): Promise<string[]> {
  const raw = stripLeadingFrontmatter(
    await chat(
      settings.apiKey,
      settings.model,
      prompt,
      buildUserPrompt(jobs, anchors, styleNudge),
      signal,
      onActivity,
    ),
  );
  return parseNumberedBlocks(raw, jobs.length);
}

async function translateUnitGroup(
  units: string[],
  settings: ExtensionSettings,
  signal: AbortSignal | undefined,
  onActivity: (() => void) | undefined,
  anchors: string[],
  depth = 0,
  onDetail?: (note: string) => void,
): Promise<string[]> {
  const zhOut = units.map(() => "");
  const jobs = units.map((u, i) => ({ u, i })).filter((x) => !isProtectedUnit(x.u));
  if (jobs.length === 0) return zhOut;

  const bisect = async () => {
    const mid = Math.ceil(units.length / 2);
    console.log("[p2r][translate] 对半拆分（编号/格式失败）", units.length, "->", mid, "+", units.length - mid);
    onDetail?.("拆分后重试");
    const a = await translateUnitGroup(units.slice(0, mid), settings, signal, onActivity, anchors, depth + 1, onDetail);
    const b = await translateUnitGroup(units.slice(mid), settings, signal, onActivity, anchors, depth + 1, onDetail);
    return [...a, ...b];
  };

  let parsed: string[] | null = null;
  let lastErr: Error | null = null;
  let failed: { u: string; i: number }[] = [];
  let usableZh: string[] | null = null;

  for (let attempt = 0; attempt < GROUP_ATTEMPTS; attempt++) {
    try {
      console.log("[p2r][translate] 请求组 块数=", jobs.length, "depth=", depth, "attempt=", attempt + 1);
      onDetail?.(attempt === 0 ? "请求中" : `重试 ${attempt + 1}`);
      parsed = await fetchParsedBlocks(jobs, settings, signal, anchors, attempt > 0, onActivity);
      failed = [];
      for (let n = 0; n < jobs.length; n++) {
        if (looksTranslated(jobs[n].u, parsed[n])) zhOut[jobs[n].i] = parsed[n];
        else failed.push(jobs[n]);
      }
      if (failed.length) {
        throw new Error(`第 ${jobs.indexOf(failed[0]) + 1} 块不像中文译文`);
      }
      if (groupLooksStiff(zhOut) && attempt + 1 < GROUP_ATTEMPTS) {
        usableZh = [...zhOut];
        throw new Error("风格偏书面，将重试");
      }
      onActivity?.();
      return zhOut;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.log("[p2r][translate] 分组失败，将重试:", lastErr.message);
      if (parsed && failed.length && !/风格偏书面/.test(lastErr.message)) {
        break;
      }
      parsed = null;
    }
  }

  if (!parsed) {
    if (usableZh) {
      onActivity?.();
      return usableZh;
    }
    if (units.length > 1 && depth < 4) return bisect();
    throw lastErr ?? new Error("翻译分组失败");
  }

  if (failed.length === jobs.length && jobs.length > 1 && depth < 4) {
    return bisect();
  }

  if (failed.length && jobs.length > 1 && failed.length < jobs.length) {
    const subset = failed.map((j) => units[j.i]);
    console.log("[p2r][translate] 仅重试无中文的块", failed.length, "/", jobs.length);
    const recovered = await translateUnitGroup(subset, settings, signal, onActivity, anchors, depth + 1, onDetail);
    for (let k = 0; k < failed.length; k++) zhOut[failed[k].i] = recovered[k];
    onActivity?.();
    return zhOut;
  }

  if (failed.length) {
    console.log(
      "[p2r][translate] 保留英文原块:",
      failed.map((j) => j.u.replace(/\s+/g, " ").slice(0, 80)),
    );
  }
  onActivity?.();
  return zhOut;
}

export async function translateBilingual(
  originalMarkdown: string,
  settings: ExtensionSettings,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number, detail?: string) => void,
  onActivity?: () => void,
): Promise<string> {
  if (!settings.apiKey) throw new Error("未配置 DeepSeek API Key");
  const { frontmatter, body } = splitFrontmatter(originalMarkdown);

  const units = splitIntoUnits(body);
  const lineCount = body.split("\n").length;
  const groups = packSectionGroups(units);
  console.log(
    "[p2r][translate] 对照拼接 块=",
    units.length,
    "组=",
    groups.length,
    "行=",
    lineCount,
    "字符=",
    body.length,
  );

  const zhByUnit: string[] = [];
  let anchors: string[] = [];
  const startedAt = Date.now();

  for (let g = 0; g < groups.length; g++) {
    if (signal?.aborted) throw new Error(abortMessage(signal));
    if (Date.now() - startedAt > TRANSLATE_MAX_MS) {
      throw new Error("翻译超时：分段翻译超过 12 分钟仍未完成");
    }
    onProgress?.(g, groups.length, `第 ${g + 1}/${groups.length} 组`);
    const group = groups[g];
    const zh = await translateUnitGroup(group, settings, signal, onActivity, anchors, 0, (note) => {
      onProgress?.(g, groups.length, `第 ${g + 1}/${groups.length} 组 · ${note}`);
    });
    zhByUnit.push(...zh);
    onProgress?.(g + 1, groups.length);
    const joinedZh = zh.filter(Boolean).join("\n\n");
    if (joinedZh && anchors.length < 3) {
      anchors = mergeAnchors(anchors, extractStyleAnchors(joinedZh));
    }
  }

  if (zhByUnit.length !== units.length) {
    throw new Error("中英对照拼接失败：译文块数与原文不一致");
  }

  const merged = assembleBilingual(units, zhByUnit);
  logStyleConsistency(merged);
  const zhChars = (merged.match(/[㐀-鿿]/g) || []).length;
  const latinChars = (merged.match(/[A-Za-z]/g) || []).length;
  console.log("[p2r][translate] 拼接完成 CJK=", zhChars, "Latin=", latinChars);
  if (body.replace(/\s/g, "").length > 200 && (latinChars < 80 || zhChars < 80)) {
    throw new Error("中英对照校验失败：译文缺少原文或中文");
  }
  return frontmatter + merged;
}
