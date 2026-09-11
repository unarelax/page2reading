import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { assertInsideRoot } from "./paths.js";

/** Failed-task HTML snapshots live here; delete after this age. */
export const INBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function inboxDir(config: AppConfig): string {
  const dir = join(config.configDir, "inbox");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function capturePath(config: AppConfig, taskId: string): string {
  const path = join(inboxDir(config), `${taskId}.html`);
  assertInsideRoot(config.configDir, path);
  return path;
}

export function writeCapture(config: AppConfig, taskId: string, html: string): string {
  const path = capturePath(config, taskId);
  writeFileSync(path, html, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function readCapture(
  config: AppConfig,
  row: { id: string; html?: string | null; html_path?: string | null },
): string {
  const path = row.html_path || (row.id ? capturePath(config, row.id) : "");
  if (path && existsSync(path)) {
    return readFileSync(path, "utf8");
  }
  if (row.html && row.html.length > 20) return row.html;
  return "";
}

export function unlinkCaptureFile(config: AppConfig, taskId: string, htmlPath?: string | null): void {
  const candidates = [htmlPath, capturePath(config, taskId)].filter((p): p is string => Boolean(p));
  for (const path of candidates) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore missing files
    }
  }
}

export function purgeExpiredCaptures(
  config: AppConfig,
  nowMs = Date.now(),
  maxAgeMs = INBOX_MAX_AGE_MS,
): number {
  const dir = inboxDir(config);
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".html")) continue;
    const path = join(dir, name);
    try {
      const age = nowMs - statSync(path).mtimeMs;
      if (age <= maxAgeMs) continue;
      unlinkSync(path);
      removed += 1;
    } catch {
      // ignore races / missing files
    }
  }
  return removed;
}
