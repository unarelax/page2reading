import { describe, expect, it } from "vitest";
import { buildFooterTemplate, footerTitle, FOOTER_TITLE_MAX_CHARS } from "./pdf-footer.js";

describe("页脚标题", () => {
  it("折叠空白并去掉首尾空格", () => {
    expect(footerTitle("  三段式\t标题\n第二行  ")).toBe("三段式 标题 第二行");
  });

  it("空标题用占位词", () => {
    expect(footerTitle("")).toBe("未命名");
    expect(footerTitle("   ")).toBe("未命名");
    expect(footerTitle(null)).toBe("未命名");
    expect(footerTitle(undefined)).toBe("未命名");
  });

  it("过长标题截断到上限并加省略号", () => {
    const long = "标".repeat(FOOTER_TITLE_MAX_CHARS + 8);
    const out = footerTitle(long);
    expect(out.length).toBe(FOOTER_TITLE_MAX_CHARS + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(footerTitle("标".repeat(FOOTER_TITLE_MAX_CHARS))).toBe("标".repeat(FOOTER_TITLE_MAX_CHARS));
  });
});

describe("页脚模板", () => {
  it("转义标题里的标记与引号", () => {
    const html = buildFooterTemplate('<script>alert("x")</script> & Co');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;x&quot;");
    expect(html).toContain("&amp; Co");
    expect(html).toContain('class="pageNumber"');
  });

  it("页码与标题用间隔点连在底部居中一行", () => {
    const html = buildFooterTemplate("一篇文章");
    expect(html).toContain('<span class="pageNumber"></span> · 一篇文章');
    expect(html).toContain("text-align:center");
    expect(html).toContain("font-size:9pt");
    expect(html).not.toContain("totalPages");
  });
});
