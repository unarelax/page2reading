import { describe, expect, it } from "vitest";
import { buildFrontmatter } from "./paths.js";
import { markdownToHtml } from "./render.js";

const frontmatter = buildFrontmatter({
  title: '标题里有 <b> 与 "引号"',
  author: "Ada",
  published: "2024-12-31",
  source: "https://example.com/a?b=1",
  collected: "2026-09-16T00:00:00.000Z",
});

describe("markdownToHtml", () => {
  it("封面页放 eyebrow、36pt 大标题与元信息", async () => {
    const { html, title } = await markdownToHtml(`${frontmatter}# 小标题\n\n正文一段。\n`, "original");
    expect(title).toBe('标题里有 <b> 与 "引号"');
    expect(html).toContain('class="doc-cover"');
    expect(html).toContain('class="doc-eyebrow"');
    expect(html).toContain('class="doc-cover-title"');
    expect(html).toContain('class="doc-cover-author"');
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("发布日期：2024年12月");
    expect(html).toContain("提取日期：2026年9月16日");
    expect(html).not.toContain('class="print-sheet"');
    expect(html).not.toContain("print-gap");
  });

  it("eyebrow 有作者用作者，没有就用域名，并带上导出模式", async () => {
    const withAuthor = await markdownToHtml(`${frontmatter}正文。\n`, "bilingual");
    expect(withAuthor.html).toContain("Ada · 中英对照");

    const noAuthor = buildFrontmatter({
      title: "无作者",
      author: null,
      published: null,
      source: "https://www.example.com/a",
      collected: "2026-09-16T00:00:00.000Z",
    });
    const withoutAuthor = await markdownToHtml(`${noAuthor}正文。\n`, "original");
    expect(withoutAuthor.html).toContain("example.com · 原文");
  });

  it("文档里注入页脚 @page 规则，封面页无页脚", async () => {
    const { html } = await markdownToHtml(`${frontmatter}正文。\n`, "original");
    expect(html).toContain("counter(page)");
    expect(html).toContain("@page:first { @bottom-center { content: none; } }");
  });

  it("没有作者时不输出作者行", async () => {
    const noAuthor = buildFrontmatter({
      title: "无作者",
      author: null,
      published: null,
      source: "https://example.com/b",
      collected: "2026-09-16T00:00:00.000Z",
    });
    const { html } = await markdownToHtml(`${noAuthor}正文。\n`, "original");
    expect(html).not.toContain('class="doc-cover-author"');
  });

  it("中英对照按语种给段落打类", async () => {
    const { html } = await markdownToHtml(
      `${frontmatter}Hello world.\n\n这是中文段落。\n`,
      "bilingual",
    );
    expect(html).toContain('<p class="en">Hello world.</p>');
    expect(html).toContain('<p class="zh">这是中文段落。</p>');
  });
});
