import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractArticle } from "../src/extractor/extract.js";
import { buildFrontmatter, parseFrontmatter } from "../src/storage/paths.js";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/sample.html");

describe("抽取样例 HTML", () => {
  it("抽出正文并带 YAML frontmatter", () => {
    const html = readFileSync(fixture, "utf8");
    const extracted = extractArticle(html, "https://example.com/sample", "fallback");
    expect(extracted.title).toBe("Sample Article for Page2Reading");
    expect(extracted.author).toBe("Test Author");
    expect(extracted.publishedAt).toBe("2026-09-08");
    expect(extracted.markdown).toMatch(/first paragraph/i);

    const md = `${buildFrontmatter({
      title: extracted.title,
      author: extracted.author,
      published: extracted.publishedAt,
      source: "https://example.com/sample",
      collected: "2026-09-11T03:00:00.000Z",
    })}${extracted.markdown}\n`;

    expect(md.startsWith("---\n")).toBe(true);
    const parsed = parseFrontmatter(md);
    expect(parsed.title).toBe("Sample Article for Page2Reading");
    expect(parsed.author).toBe("Test Author");
    expect(parsed.published).toBe("2026-09-08");
    expect(parsed.sourceUrl).toBe("https://example.com/sample");
    expect(parsed.collected).toBe("2026-09-11T03:00:00.000Z");
    expect(parsed.body).toMatch(/Why this exists/);
  });
});
