/** PDF 页脚：底部居中「当前页 · 文章标题」。Chrome 不支持 @page 边距盒，页脚由 CDP 的 footerTemplate 画。 */

/** 标题在页脚里只占一行；超过这个长度就截断，避免居中文字溢出纸面。 */
export const FOOTER_TITLE_MAX_CHARS = 40;

const FOOTER_STYLE =
  "width:100%;box-sizing:border-box;padding:0 22mm 10mm 22mm;text-align:center;" +
  "font-size:9pt;color:#6b6a64;" +
  "font-family:'Songti SC','STSong','Source Han Serif SC','Noto Serif CJK SC',Georgia,serif;" +
  "white-space:nowrap;overflow:hidden;";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 折叠空白、去掉首尾空格；空标题给一个占位词，过长则截断。 */
export function footerTitle(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "未命名";
  if (cleaned.length <= FOOTER_TITLE_MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, FOOTER_TITLE_MAX_CHARS)}…`;
}

export function buildFooterTemplate(rawTitle: string | null | undefined): string {
  return `<div style="${FOOTER_STYLE}"><span class="pageNumber"></span> · ${escapeHtml(footerTitle(rawTitle))}</div>`;
}
