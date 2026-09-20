import MarkdownIt from "markdown-it";
import QRCode from "qrcode";
import type { ExportMode } from "../types.js";
import { parseFrontmatter } from "./paths.js";
import css from "../pdf/style.css?raw";

const CJK = /[㐀-鿿豈-﫿]/;

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

async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    width: 128,
  });
}

/** 把最终 Markdown（原文或对照）转成用于打印的完整 HTML 文档字符串。 */
export async function markdownToHtml(
  mdSource: string,
  mode: ExportMode,
): Promise<{ html: string; title: string }> {
  const { body, title, sourceUrl, author, published } = parseFrontmatter(mdSource);
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const html = addLangClasses(md.render(body));
  const metaBits = [author, published].filter(Boolean).join(" · ");
  const qr = sourceUrl ? await qrSvg(sourceUrl) : "";
  const endmatter = `
<footer class="doc-endmatter">
  <div class="doc-end-row">
    <div class="doc-end-text">
      ${title ? `<p class="doc-title">${escapeHtml(title)}</p>` : ""}
      ${metaBits ? `<p class="doc-meta">${escapeHtml(metaBits)}</p>` : ""}
      ${sourceUrl ? `<p class="doc-source">${escapeHtml(sourceUrl)}</p>` : ""}
    </div>
    ${qr ? `<div class="doc-qr" aria-hidden="true">${qr}</div>` : ""}
  </div>
</footer>`;
  const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title || "document")}</title>
<style>${css}</style>
</head>
<body class="mode-${mode}">
${html}
${endmatter}
</body>
</html>`;
  return { html: doc, title };
}
