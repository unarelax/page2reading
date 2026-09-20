import type {
  PdfResultMessage,
  RequestPdfMessage,
  RunMessage,
} from "./types.js";
import { extractArticle } from "./lib/extract.js";
import { translateBilingual } from "./lib/translate.js";
import { markdownToHtml } from "./lib/render.js";
import { allocateArticleFiles, buildFrontmatter } from "./lib/paths.js";
import { writeBinaryFile, writeTextFile } from "./lib/fs.js";

interface PendingPdf {
  resolve: (v: { bytes: Uint8Array; failedImages: string[] }) => void;
  reject: (e: Error) => void;
}

const port = chrome.runtime.connect({ name: "pipeline" });
const pendingPdfs = new Map<string, PendingPdf>();
let runChain: Promise<void> = Promise.resolve();

function progress(taskId: string, status: string): void {
  port.postMessage({ type: "progress", taskId, status });
}

function requestPdf(
  taskId: string,
  html: string,
  mode: "original" | "bilingual",
  fileName: string,
): Promise<{ bytes: Uint8Array; failedImages: string[] }> {
  return new Promise((resolve, reject) => {
    pendingPdfs.set(taskId, {
      resolve: (v) => resolve(v),
      reject,
    });
    const msg: RequestPdfMessage = { type: "request-pdf", taskId, html, mode, fileName };
    port.postMessage(msg);
  });
}

async function runPipeline(run: RunMessage): Promise<void> {
  const { taskId } = run;
  progress(taskId, "extracting");
  const extracted = extractArticle(run.html, run.url, run.pageTitle ?? undefined);
  const files = allocateArticleFiles(extracted.title, run.collectedAt);

  const original = `${buildFrontmatter({
    title: extracted.title,
    author: extracted.author,
    published: extracted.publishedAt,
    source: run.url,
    collected: run.collectedAt,
  })}${extracted.markdown}\n`;
  await writeTextFile(files.originalMarkdown, original);

  let pdfSource = original;
  let pdfMode: "original" | "bilingual" = "original";
  let pdfFileName = files.originalPdf;
  let bilingualMarkdown: string | null = null;

  if (run.mode === "bilingual") {
    progress(taskId, "translating");
    const bilingual = await translateBilingual(original, run.settings);
    await writeTextFile(files.bilingualMarkdown, bilingual);
    bilingualMarkdown = files.bilingualMarkdown;
    pdfSource = bilingual;
    pdfMode = "bilingual";
    pdfFileName = files.bilingualPdf;
  }

  const { html } = await markdownToHtml(pdfSource, pdfMode);
  const pdf = await requestPdf(taskId, html, pdfMode, pdfFileName);
  await writeBinaryFile(pdfFileName, pdf.bytes, "application/pdf");

  const warnings = pdf.failedImages.length
    ? [`PDF 图片加载失败 ${pdf.failedImages.length} 张：${pdf.failedImages.slice(0, 5).join(" ")}`]
    : [];
  const status = warnings.length ? "succeeded_with_warnings" : "succeeded";

  port.postMessage({
    type: "done",
    taskId,
    status,
    warnings,
    files: {
      originalMarkdown: files.originalMarkdown,
      bilingualMarkdown,
      pdf: pdfFileName,
    },
  });
}

port.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; taskId?: string };
  if (m?.type === "run") {
    runChain = runChain
      .then(() => runPipeline(m as unknown as RunMessage))
      .catch((err) => {
        port.postMessage({
          type: "failed",
          taskId: m.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (m?.type === "pdf-result") {
    const p = pendingPdfs.get(m.taskId!);
    if (p) {
      pendingPdfs.delete(m.taskId!);
      const r = m as unknown as PdfResultMessage;
      p.resolve({
        bytes: Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)),
        failedImages: r.failedImages,
      });
    }
    return;
  }
  if (m?.type === "pdf-error") {
    const p = pendingPdfs.get(m.taskId!);
    if (p) {
      pendingPdfs.delete(m.taskId!);
      p.reject(new Error((m as { error?: string }).error || "PDF 生成失败"));
    }
    return;
  }
});
