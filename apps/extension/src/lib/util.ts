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
