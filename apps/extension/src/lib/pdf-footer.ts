/** PDF 页脚：底部居中「当前页 · 文章标题」，由 @page 的边距盒画；封面页不印页脚。 */

/** 标题在页脚里只占一行；超过这个长度就截断，避免居中文字溢出纸面。 */
export const FOOTER_TITLE_MAX_CHARS = 40;

/** 折叠空白、去掉首尾空格；空标题给一个占位词，过长则截断。 */
export function footerTitle(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "未命名";
  if (cleaned.length <= FOOTER_TITLE_MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, FOOTER_TITLE_MAX_CHARS)}…`;
}

/**
 * CSS 字符串字面量里的转义。标题来自被导出的页面，这段 CSS 又会拼进 <style>，
 * 所以尖括号必须转成 CSS 转义序列，否则标题里的 `</style>` 能提前闭合样式元素。
 * 换行已在 footerTitle 里折叠掉。
 */
function escapeCssString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\3c ")
    .replace(/>/g, "\\3e ")
    .replace(/\r?\n/g, " ");
}

/**
 * 每份文档单独注入的 @page 规则：页脚内容要带文章标题，只能由 HTML 现场拼。
 * @page:first 让封面页不印页脚，和 Kami 的封面一致。
 */
export function buildFooterCss(rawTitle: string | null | undefined): string {
  return [
    "@page {",
    "  @bottom-center {",
    `    content: counter(page) " · " "${escapeCssString(footerTitle(rawTitle))}";`,
    "    font-size: 9pt;",
    "    color: #6b6a64;",
    '    font-family: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Georgia, serif;',
    "    margin-bottom: 13mm;",
    "  }",
    "}",
    "@page:first { @bottom-center { content: none; } }",
  ].join("\n");
}
