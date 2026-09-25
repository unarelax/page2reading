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

/** 连续无进度超过此时长才中止；单次 DeepSeek / printToPDF 都可能要 1～3 分钟。 */
export const PIPELINE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** 防死循环的总上限。长文对照按段翻译，整体经常超过 6 分钟。 */
export const PIPELINE_HARD_TIMEOUT_MS = 90 * 60 * 1000;
export const TIMEOUT_MESSAGE = "导出超时：长时间没有进度，请稍后重试";
export const HARD_TIMEOUT_MESSAGE = "导出超时：整篇处理超过 90 分钟仍未完成";

export function abortMessage(signal: AbortSignal): string {
  return typeof signal.reason === "string" && signal.reason ? signal.reason : TIMEOUT_MESSAGE;
}
