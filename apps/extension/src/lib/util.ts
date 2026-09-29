export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "ref",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
  ]);
  const kept = [...url.searchParams.entries()].filter(([k]) => !drop.has(k.toLowerCase()));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  return url.toString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** 本地日历日 YYYYMMDD，如 20260909 */
export function collectedDayStamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function slugifyTitle(title: string): string {
  const cleaned = title
    .normalize("NFKC")
    .replace(/[\/\\?%*:|"<>]/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "untitled";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单次 DeepSeek 请求多久没返回就放弃这一次。 */
export const REQUEST_TIMEOUT_MS = 45_000;
/** 对照翻译整体上限。超时此时还没有 Markdown。 */
export const TRANSLATE_MAX_MS = 12 * 60 * 1000;
/** 连续没有任何完成的进度（译完一组、写出文件、PDF 分块）就停。要大于 printToPDF 的 180 秒。 */
export const PIPELINE_IDLE_TIMEOUT_MS = 4 * 60 * 1000;
/** 整篇任务硬上限：翻译 12 分钟 + 短文 PDF。 */
export const PIPELINE_HARD_TIMEOUT_MS = 18 * 60 * 1000;
/** 新建 offscreen 后多久还没连上管道，就放弃这一篇，避免队列永久占着。 */
export const OFFSCREEN_CONNECT_TIMEOUT_MS = 15_000;
export const TIMEOUT_MESSAGE = "导出超时：长时间没有进度，请稍后重试";
export const HARD_TIMEOUT_MESSAGE = "导出超时：整篇处理超过 18 分钟仍未完成";

export function abortMessage(signal: AbortSignal): string {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : TIMEOUT_MESSAGE;
}
