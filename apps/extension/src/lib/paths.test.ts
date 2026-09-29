import { describe, expect, it } from "vitest";
import { allocateArticleFiles, buildFrontmatter, parseFrontmatter } from "./paths.js";
import { collectedDayStamp, normalizeUrl, slugifyTitle, toDateOnly } from "./util.js";

describe("slug and paths", () => {
  it("去掉文件名里的非法字符", () => {
    expect(slugifyTitle("a/b:c")).toBe("a-b-c");
    expect(slugifyTitle("...")).toBe(".");
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("x".repeat(200)).length).toBe(80);
  });

  it("frontmatter 往返保留引号", () => {
    const src = buildFrontmatter({
      title: 'Say "hi"',
      author: "Ada",
      published: "2024-12-31",
      source: "https://example.com/a?b=1",
      collected: "2026-09-19T00:00:00.000Z",
    });
    expect(parseFrontmatter(`${src}# Hello\n`)).toEqual({
      body: "# Hello\n",
      title: 'Say "hi"',
      sourceUrl: "https://example.com/a?b=1",
      author: "Ada",
      published: "2024-12-31",
      collected: "2026-09-19T00:00:00.000Z",
    });
  });

  it("按本地日历日归档", () => {
    const iso = "2026-09-19T16:30:00.000Z";
    const day = new Date(iso);
    const stamp = [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    ].join("");
    expect(collectedDayStamp(iso)).toBe(stamp);
    expect(allocateArticleFiles("Hello", iso).dir).toBe(stamp);
    expect(allocateArticleFiles("Hello", iso).originalMarkdown).toBe(`${stamp}/or-Hello.md`);
  });
});

describe("dates and urls", () => {
  it("以日期开头的字符串不按 UTC 改日", () => {
    expect(toDateOnly("2024-12-31T23:00:00-05:00")).toBe("2024-12-31");
  });

  it("不以日期开头的时刻会换成 UTC 日期", () => {
    expect(toDateOnly("Tue, 31 Dec 2024 23:00:00 -0500")).toBe("2025-01-01");
  });

  it("去掉追踪参数并排序", () => {
    expect(normalizeUrl("https://example.com/a?utm_source=x&b=2&a=1#frag")).toBe(
      "https://example.com/a?a=1&b=2",
    );
  });
});
