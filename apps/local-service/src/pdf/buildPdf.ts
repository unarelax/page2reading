import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import MarkdownIt from "markdown-it";
import QRCode from "qrcode";
import puppeteer, { type Page } from "puppeteer-core";
import type { ExportMode } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import { detectChromePath } from "../config.js";
import { parseFrontmatter } from "../storage/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CJK = /[㐀-鿿豈-﫿]/;

export interface PdfResult {
  pdfPath: string;
  failedImages: string[];
}

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

async function markdownToHtml(mdSource: string, mode: ExportMode): Promise<{ html: string; title: string }> {
  const { body, title, sourceUrl, author, published } = parseFrontmatter(mdSource);
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const html = addLangClasses(md.render(body));
  const css = readFileSync(join(__dirname, "style.css"), "utf8");
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

async function waitForImages(page: Page, timeoutMs: number): Promise<string[]> {
  return page.evaluate(async (deadlineMs) => {
    const failed: string[] = [];
    const imgs = Array.from(document.images);
    const deadline = Date.now() + deadlineMs;
    for (const img of imgs) {
      const remaining = Math.max(300, deadline - Date.now());
      if (img.complete && img.naturalWidth > 0) continue;
      if (img.complete && img.naturalWidth === 0 && img.src) {
        const src = img.src;
        img.src = "";
        img.src = src;
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ]);
      if (!(img.complete && img.naturalWidth > 0)) failed.push(img.currentSrc || img.src);
    }
    return failed;
  }, timeoutMs);
}

export async function buildPdf(options: {
  markdown: string;
  outputPdf: string;
  mode: ExportMode;
  config: AppConfig;
}): Promise<PdfResult> {
  const chromePath = detectChromePath(options.config.chromePath);
  if (!chromePath) throw new Error("找不到本机 Chrome，请设置 CHROME_PATH");

  mkdirSync(dirname(options.outputPdf), { recursive: true });
  const { html } = await markdownToHtml(options.markdown, options.mode);
  const tmpDir = await mkdtemp(join(tmpdir(), "p2r-pdf-"));
  const tmpPdf = join(tmpDir, "output.pdf");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-gpu", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const failedImages = await waitForImages(page, options.config.imageLoadTimeoutMs);
    await page.pdf({
      path: tmpPdf,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    const size = statSync(tmpPdf).size;
    if (size < 1024) throw new Error(`PDF 过小，可能生成失败（${size} bytes）`);
    renameSync(tmpPdf, options.outputPdf);
    return { pdfPath: options.outputPdf, failedImages };
  } finally {
    await browser.close().catch(() => undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
