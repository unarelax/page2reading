import MarkdownIt from "markdown-it";
import QRCode from "qrcode";
import type { ExportMode } from "../types.js";
import { buildFooterCss } from "./pdf-footer.js";
import { parseFrontmatter } from "./paths.js";
import css from "../pdf/style.css?raw";

const CJK = /[㐀-鿿豈-﫿]/;
/** 原文正文超过这个长度，就不生成 PDF。对照按原文计，图只是链接，不计入。 */
export const PDF_MAX_CHARS = 30_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addLangClasses(html: string): string {
  return html.replace(/<(p|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (_m, tag, attrs, inner) => {
    const cls = CJK.test(inner) ? "zh" : "en";
    if (attrs && /\bclass=/.test(attrs)) {
      return `<${tag}${attrs.replace(/(class="[^"]*)"/, `$1 ${cls}"`)}>${inner}</${tag}>`;
    }
    return `<${tag} class="${cls}">${inner}</${tag}>`;
  });
}

async function qrPng(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 1,
    errorCorrectionLevel: "M",
    width: 192,
    color: { dark: "#111111", light: "#ffffff" },
  });
}

function formatPublished(published: string | null): string {
  if (!published) return "未知";
  const m = published.match(/^(\d{4})-(\d{2})/);
  if (!m) return published;
  return `${Number(m[1])}年${Number(m[2])}月`;
}

function formatCollected(collected: string): string {
  if (!collected) return "未知";
  const d = new Date(collected);
  if (Number.isNaN(d.getTime())) return collected;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 封面 eyebrow 左半边：有作者就用作者，没有就用原文域名（如 paulgraham.com）。 */
function eyebrowSource(author: string, sourceUrl: string): string {
  if (author) return author;
  if (!sourceUrl) return "";
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 按原文正文判断：超过约 3 万字则跳过 PDF；短文返回 null。 */
export function skipPdfReason(originalMd: string): string | null {
  const { body } = parseFrontmatter(originalMd);
  if (body.length > PDF_MAX_CHARS) return "篇幅较长，未生成 PDF";
  return null;
}

/** 把最终 Markdown 转成隐藏打印页用的 HTML，不落盘。 */
export async function markdownToHtml(
  mdSource: string,
  mode: ExportMode,
): Promise<{ html: string; title: string }> {
  const { body, title, sourceUrl, author, published, collected } = parseFrontmatter(mdSource);
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  const html = addLangClasses(md.render(body));
  const metaBits = [author, published].filter(Boolean).join(" · ");
  const qr = sourceUrl ? await qrPng(sourceUrl) : "";
  // 封面：eyebrow（墨蓝）+ 36pt 大标题在上，作者/日期/原文链接贴在下半屏底。
  const eyebrow = [eyebrowSource(author, sourceUrl), mode === "bilingual" ? "中英对照" : "原文"]
    .filter(Boolean)
    .join(" · ");
  const cover = `
<section class="doc-cover">
  <div>
    <p class="doc-eyebrow">${escapeHtml(eyebrow)}</p>
    <h1 class="doc-cover-title">${escapeHtml(title || "Untitled")}</h1>
  </div>
  <div class="doc-cover-meta">
    ${author ? `<p class="doc-cover-author">${escapeHtml(author)}</p>` : ""}
    <p class="doc-meta">发布日期：${formatPublished(published)}</p>
    <p class="doc-meta">提取日期：${formatCollected(collected)}</p>
    ${sourceUrl ? `<p class="doc-source">${escapeHtml(sourceUrl)}</p>` : ""}
  </div>
</section>`;
  const endmatter = `
<div class="doc-endmatter">
  <table class="doc-end-table">
    <tr>
      <td class="doc-end-text">
        ${title ? `<p class="doc-title">${escapeHtml(title)}</p>` : ""}
        ${metaBits ? `<p class="doc-meta">${escapeHtml(metaBits)}</p>` : ""}
        ${sourceUrl ? `<p class="doc-source">${escapeHtml(sourceUrl)}</p>` : ""}
      </td>
      ${qr ? `<td class="doc-qr"><img class="doc-qr-img" src="${qr}" alt="" width="96" height="96"></td>` : ""}
    </tr>
  </table>
</div>`;
  const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title || "document")}</title>
<style>${css}</style>
<style>${buildFooterCss(title)}</style>
</head>
<body class="mode-${mode}">
${cover}
${html}
${endmatter}
</body>
</html>`;
  return { html: doc, title };
}
