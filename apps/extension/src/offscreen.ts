import type {
  PdfChunkMessage,
  PdfResultMessage,
  RequestPdfMessage,
  RunMessage,
} from "./types.js";
import { extractArticle } from "./lib/extract.js";
import { translateBilingual } from "./lib/translate.js";
import { markdownToHtml } from "./lib/render.js";
import { allocateArticleFiles, buildFrontmatter } from "./lib/paths.js";
import { base64ToBytes } from "./lib/base64-chunks.js";
import { openBinaryWriter, uniquifyStem, writeTextFile } from "./lib/fs.js";
import {
  abortMessage,
  HARD_TIMEOUT_MESSAGE,
  PIPELINE_HARD_TIMEOUT_MS,
  PIPELINE_IDLE_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
} from "./lib/util.js";

interface PendingPdf {
  fileName: string;
  resolve: (v: { byteLength: number; failedImages: string[] }) => void;
  reject: (e: Error) => void;
  writer: Awaited<ReturnType<typeof openBinaryWriter>> | null;
  writes: Promise<void>;
  bytesWritten: number;
  cancelled: boolean;
}

const port = chrome.runtime.connect({ name: "pipeline" });
console.log("[p2r][offscreen] pipeline 端口已连接");
port.onDisconnect.addListener(() => console.log("[p2r][offscreen] pipeline 端口已断开"));
const pendingPdfs = new Map<string, PendingPdf>();
let runChain: Promise<void> = Promise.resolve();
let activityBump: (() => void) | null = null;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(abortMessage(signal));
}

function startWatchdog(controller: AbortController): { bump: () => void; stop: () => void } {
  const startedAt = Date.now();
  let lastActivity = startedAt;
  const bump = () => {
    lastActivity = Date.now();
  };
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    const now = Date.now();
    if (now - startedAt >= PIPELINE_HARD_TIMEOUT_MS) {
      console.log("[p2r][offscreen] 90 分钟总上限，触发 abort");
      controller.abort(HARD_TIMEOUT_MESSAGE);
    } else if (now - lastActivity >= PIPELINE_IDLE_TIMEOUT_MS) {
      console.log("[p2r][offscreen] 5 分钟无进度，触发 abort");
      controller.abort(TIMEOUT_MESSAGE);
    }
  }, 2000);
  return { bump, stop: () => clearInterval(timer) };
}

function requestPdf(
  taskId: string,
  html: string,
  mode: "original" | "bilingual",
  fileName: string,
  signal: AbortSignal,
): Promise<{ byteLength: number; failedImages: string[] }> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const pending = pendingPdfs.get(taskId);
      if (pending) pending.cancelled = true;
      pendingPdfs.delete(taskId);
      void pending?.writer?.abort().catch(() => undefined);
      reject(new Error(abortMessage(signal)));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pendingPdfs.set(taskId, {
      fileName,
      writer: null,
      writes: Promise.resolve(),
      bytesWritten: 0,
      cancelled: false,
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
    console.log("[p2r][offscreen] 发送 request-pdf，taskId=", taskId);
    port.postMessage(msg);
  });
}

async function runPipeline(run: RunMessage, signal: AbortSignal, bump: () => void): Promise<void> {
  const { taskId } = run;
  const progress = (status: string, note?: string) => {
    bump();
    console.log("[p2r][offscreen] progress ->", status, note ?? "");
    port.postMessage({ type: "progress", taskId, status, note });
  };

  console.log("[p2r][offscreen] runPipeline 开始，taskId=", taskId, "mode=", run.mode);
  progress("extracting");
  const extracted = extractArticle(run.html, run.url, run.pageTitle ?? undefined);
  bump();
  console.log("[p2r][offscreen] 提取完成，标题=", extracted.title);
  const files = allocateArticleFiles(extracted.title, run.collectedAt);
  const prefix = run.mode === "original" ? "or" : "tr";
  const stem = await uniquifyStem(files.dir, `${prefix}-${files.slug}`);
  bump();
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
    bump();
    console.log("[p2r][offscreen] md 已写入:", markdownPath);
  } else {
    progress("translating");
    const bilingual = await translateBilingual(
      original,
      run.settings,
      signal,
      (done, total) => {
        progress("translating", `${done}/${total}`);
      },
      bump,
    );
    throwIfAborted(signal);
    console.log("[p2r][offscreen] 翻译完成，开始写 md");
    await writeTextFile(markdownPath, bilingual);
    bump();
    console.log("[p2r][offscreen] md 已写入:", markdownPath);
    bilingualMarkdown = markdownPath;
    pdfSource = bilingual;
    pdfMode = "bilingual";
  }

  throwIfAborted(signal);
  progress("rendering");
  console.log("[p2r][offscreen] 开始 markdownToHtml");
  const { html } = await markdownToHtml(pdfSource, pdfMode);
  bump();
  console.log("[p2r][offscreen] markdownToHtml 完成，开始请求 PDF");
  throwIfAborted(signal);
  const pdf = await requestPdf(taskId, html, pdfMode, pdfFileName, signal);
  bump();
  console.log("[p2r][offscreen] PDF 已写入:", pdfFileName, "bytes=", pdf.byteLength, "failedImages=", pdf.failedImages.length);

  const warnings = pdf.failedImages.length
    ? [`PDF 图片加载失败 ${pdf.failedImages.length} 张：${pdf.failedImages.slice(0, 5).join(" ")}`]
    : [];
  const status = warnings.length ? "succeeded_with_warnings" : "succeeded";

  console.log("[p2r][offscreen] 发送 done，status=", status);
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
    console.log("[p2r][offscreen] 收到 run，taskId=", run.taskId, "mode=", run.mode);
    runChain = runChain
      .then(() => {
        const controller = new AbortController();
        const { bump, stop } = startWatchdog(controller);
        activityBump = bump;
        return runPipeline(run, controller.signal, bump).finally(() => {
          activityBump = null;
          stop();
        });
      })
      .catch((err) => {
        console.log("[p2r][offscreen] runPipeline 异常，发送 failed:", err instanceof Error ? err.message : err);
        port.postMessage({
          type: "failed",
          taskId: run.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (m?.type === "pdf-chunk") {
    const taskId = m.taskId!;
    const p = pendingPdfs.get(taskId);
    activityBump?.();
    if (!p || p.cancelled) {
      port.postMessage({ type: "pdf-chunk-ack", taskId, error: "导出已中断" });
      return;
    }
    const data = (m as unknown as PdfChunkMessage).data;
    if (typeof data !== "string" || !data) {
      port.postMessage({ type: "pdf-chunk-ack", taskId, error: "PDF 分块无效" });
      return;
    }
    const bytes = base64ToBytes(data);
    console.log("[p2r][offscreen] 收到分块，字节=", bytes.byteLength);
    p.writes = p.writes.then(async () => {
      if (p.cancelled) throw new Error("导出已中断");
      if (!p.writer) p.writer = await openBinaryWriter(p.fileName);
      await p.writer.write(bytes);
      p.bytesWritten += bytes.byteLength;
    }).then(
      () => {
        port.postMessage({ type: "pdf-chunk-ack", taskId });
      },
      (err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        port.postMessage({ type: "pdf-chunk-ack", taskId, error });
      },
    );
    return;
  }
  if (m?.type === "pdf-result") {
    const p = pendingPdfs.get(m.taskId!);
    console.log("[p2r][offscreen] 收到 pdf-result，taskId=", m.taskId, "有 pending=", Boolean(p));
    activityBump?.();
    if (p) {
      pendingPdfs.delete(m.taskId!);
      const r = m as unknown as PdfResultMessage;
      void p.writes.then(async () => {
        if (p.cancelled) throw new Error("导出已中断");
        if (!p.writer || !(p.bytesWritten > 0)) throw new Error("PDF 为空");
        const size = await p.writer.close();
        p.writer = null;
        console.log("[p2r][offscreen] PDF 落盘大小=", size);
        p.resolve({ byteLength: size, failedImages: r.failedImages });
      }).catch(async (err: unknown) => {
        await p.writer?.abort().catch(() => undefined);
        p.writer = null;
        p.reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
    return;
  }
  if (m?.type === "pdf-error") {
    const p = pendingPdfs.get(m.taskId!);
    console.log("[p2r][offscreen] 收到 pdf-error，taskId=", m.taskId, "有 pending=", Boolean(p), "err=", (m as { error?: string }).error);
    activityBump?.();
    if (p) {
      pendingPdfs.delete(m.taskId!);
      const error = (m as { error?: string }).error || "PDF 生成失败";
      void p.writes.catch(() => undefined).then(async () => {
        await p.writer?.abort().catch(() => undefined);
        p.writer = null;
        p.reject(new Error(error));
      });
    }
    return;
  }
});
