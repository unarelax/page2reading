import type {
  PdfResultMessage,
  RequestPdfMessage,
  RunMessage,
} from "./types.js";
import { extractArticle } from "./lib/extract.js";
import { translateBilingual } from "./lib/translate.js";
import { markdownToHtml } from "./lib/render.js";
import { allocateArticleFiles, buildFrontmatter } from "./lib/paths.js";
import { uniquifyStem, writeBinaryFile, writeTextFile } from "./lib/fs.js";

interface PendingPdf {
  resolve: (v: { bytes: Uint8Array; failedImages: string[] }) => void;
  reject: (e: Error) => void;
}

const port = chrome.runtime.connect({ name: "pipeline" });
const pendingPdfs = new Map<string, PendingPdf>();
let runChain: Promise<void> = Promise.resolve();

const ORIGINAL_TIMEOUT_MS = 2 * 60 * 1000;
const BILINGUAL_TIMEOUT_MS = 4 * 60 * 1000;
const TIMEOUT_MESSAGE = "导出超时，请保持浏览器开着后重试";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(TIMEOUT_MESSAGE);
}

function progress(taskId: string, status: string): void {
  port.postMessage({ type: "progress", taskId, status });
}

function requestPdf(
  taskId: string,
  html: string,
  mode: "original" | "bilingual",
  fileName: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; failedImages: string[] }> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pendingPdfs.delete(taskId);
      reject(new Error(TIMEOUT_MESSAGE));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pendingPdfs.set(taskId, {
      resolve: (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      reject: (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    });
    const msg: RequestPdfMessage = { type: "request-pdf", taskId, html, mode, fileName };
    port.postMessage(msg);
  });
}

async function runPipeline(run: RunMessage, signal: AbortSignal): Promise<void> {
  const { taskId } = run;
  progress(taskId, "extracting");
  const extracted = extractArticle(run.html, run.url, run.pageTitle ?? undefined);
  const files = allocateArticleFiles(extracted.title, run.collectedAt);
  const prefix = run.mode === "original" ? "or" : "tr";
  const stem = await uniquifyStem(files.dir, `${prefix}-${files.slug}`);
  const markdownPath = `${files.dir}/${stem}.md`;
  const pdfFileName = `${files.dir}/${stem}.pdf`;

  const original = `${buildFrontmatter({
    title: extracted.title,
    author: extracted.author,
    published: extracted.publishedAt,
    source: run.url,
    collected: run.collectedAt,
  })}${extracted.markdown}\n`;

  let pdfSource = original;
  let pdfMode: "original" | "bilingual" = "original";
  let bilingualMarkdown: string | null = null;

  throwIfAborted(signal);
  if (run.mode === "original") {
    await writeTextFile(markdownPath, original);
  } else {
    progress(taskId, "translating");
    const bilingual = await translateBilingual(original, run.settings, signal);
    throwIfAborted(signal);
    await writeTextFile(markdownPath, bilingual);
    bilingualMarkdown = markdownPath;
    pdfSource = bilingual;
    pdfMode = "bilingual";
  }

  throwIfAborted(signal);
  const { html } = await markdownToHtml(pdfSource, pdfMode);
  throwIfAborted(signal);
  const pdf = await requestPdf(taskId, html, pdfMode, pdfFileName, signal);
  throwIfAborted(signal);
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
      originalMarkdown: run.mode === "original" ? markdownPath : null,
      bilingualMarkdown,
      pdf: pdfFileName,
    },
  });
}

port.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; taskId?: string };
  if (m?.type === "run") {
    const run = m as unknown as RunMessage;
    runChain = runChain
      .then(() => {
        const controller = new AbortController();
        const ms = run.mode === "bilingual" ? BILINGUAL_TIMEOUT_MS : ORIGINAL_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), ms);
        return runPipeline(run, controller.signal).finally(() => clearTimeout(timer));
      })
      .catch((err) => {
        port.postMessage({
          type: "failed",
          taskId: run.taskId,
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
