import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INBOX_MAX_AGE_MS, inboxDir, purgeExpiredCaptures } from "../src/storage/capture.js";
import { makeTestConfig } from "./helpers.js";

describe("inbox 过期清理", () => {
  it("删除超过 7 天的 HTML 快照，保留新文件", () => {
    const config = makeTestConfig();
    const dir = inboxDir(config);
    const oldPath = join(dir, "old-task.html");
    const newPath = join(dir, "new-task.html");
    writeFileSync(oldPath, "<html>old</html>");
    writeFileSync(newPath, "<html>new</html>");
    const eightDaysAgo = (Date.now() - INBOX_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(oldPath, eightDaysAgo, eightDaysAgo);

    const removed = purgeExpiredCaptures(config);
    expect(removed).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
  });
});
