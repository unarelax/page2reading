import { describe, expect, it } from "vitest";
import { buildFooterCss, footerTitle, FOOTER_TITLE_MAX_CHARS } from "./pdf-footer.js";

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

describe("页脚 @page 规则", () => {
  it("页码与标题连在底部居中一行", () => {
    const css = buildFooterCss("一篇文章");
    expect(css).toContain('content: counter(page) " · " "一篇文章";');
    expect(css).toContain("@bottom-center");
    expect(css).toContain("font-size: 9pt");
    expect(css).not.toContain("totalPages");
  });

  it("封面页不印页脚", () => {
    expect(buildFooterCss("一篇文章")).toContain("@page:first { @bottom-center { content: none; } }");
  });

  it("转义引号与反斜杠", () => {
    const css = buildFooterCss('他说"你好" 与 C:\\path');
    expect(css).toContain('他说\\"你好\\"');
    expect(css).toContain("C:\\\\path");
  });

  it("尖括号转成 CSS 转义，标题里的 </style> 无法闭合样式元素", () => {
    const css = buildFooterCss("</style><b>标题</b>");
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<b>");
    expect(css).toContain("\\3c /style\\3e ");
    expect(css).toContain("\\3c b\\3e ");
  });
});
