import {
  type DoneMessage,
  type FailedMessage,
  type PdfErrorMessage,
  type PdfResultMessage,
  type ProgressMessage,
  type RenderReadyMessage,
  type RequestPdfMessage,
  type RunMessage,
  type SubmitMessage,
  type TaskRecord,
} from "./types.js";
import { normalizeUrl, nowIso } from "./lib/util.js";
import { listTasks, loadSettings, upsertTask } from "./lib/storage.js";
import { bytesToBase64 } from "./lib/base64-chunks.js";
import { streamPageToPdf } from "./lib/pdf.js";

// ---- offscreen 管道状态 ----
let pipelinePort: chrome.runtime.Port | null = null;
let pendingRun: RunMessage | null = null;
let pendingPdf: {
  taskId: string;
  port: chrome.runtime.Port;
  fileName: string;
  ack: { resolve: () => void; reject: (e: Error) => void } | null;
} | null = null;
let runQueue: RunMessage[] = [];
let offscreenBusy = false;

async function ensureOffscreen(): Promise<void> {
  // 每个任务重建一个全新的 offscreen 文档，避免 SW 重启后残留旧端口导致任务卡死。
  await chrome.offscreen.closeDocument().catch(() => undefined);
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS" as chrome.offscreen.Reason],
      justification: "翻译 + 渲染 HTML + 通过 File System Access API 写入 Markdown/PDF 文件",
    });
  } catch (err) {
    if (!(err instanceof Error) || !/single offscreen/i.test(err.message)) throw err;
  }
}

function deliverRun(run: RunMessage): void {
  if (pipelinePort) pipelinePort.postMessage(run);
  else pendingRun = run;
}

function pump(): void {
  if (offscreenBusy) return;
  const run = runQueue.shift();
  if (!run) return;
  offscreenBusy = true;
  void ensureOffscreen().then(() => deliverRun(run));
}

async function updateTaskStatus(id: string, patch: Partial<TaskRecord>): Promise<void> {
  const tasks = await listTasks();
  const current = tasks.find((t) => t.id === id);
  if (!current) return;
  await upsertTask({ ...current, ...patch });
}

async function handleSubmit(msg: SubmitMessage) {
  const settings = await loadSettings();
  if (msg.mode === "bilingual" && !settings.apiKey) {
    throw new Error("请先在设置页配置 DeepSeek API Key");
  }

  const normalizedUrl = normalizeUrl(msg.url);
  const taskId = crypto.randomUUID();
  const collectedAt = nowIso();
  await upsertTask({
    id: taskId,
    url: msg.url,
    normalizedUrl,
    pageTitle: msg.pageTitle || null,
    mode: msg.mode,
    status: "queued",
    error: null,
    warnings: [],
    files: null,
    createdAt: collectedAt,
    finishedAt: null,
    progressNote: null,
  });

  runQueue.push({
    type: "run",
    taskId,
    url: msg.url,
    normalizedUrl,
    pageTitle: msg.pageTitle || null,
    html: msg.html,
    mode: msg.mode,
    collectedAt,
    settings,
  });
  pump();
  return { taskId, status: "queued" };
}

async function handleRequestPdf(msg: RequestPdfMessage, port: chrome.runtime.Port): Promise<void> {
  const { taskId, html, fileName } = msg;
  console.log("[p2r][sw] 收到 request-pdf，taskId=", taskId);
  await updateTaskStatus(taskId, { status: "rendering", progressNote: null });
  await chrome.storage.session.set({ [taskId]: { html } });
  pendingPdf = { taskId, port, fileName, ack: null };

  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`render.html?task=${encodeURIComponent(taskId)}`),
    active: false,
  });
  console.log("[p2r][sw] render 标签页已创建，tabId=", tab.id);
  if (tab.id == null) {
    pendingPdf = null;
    throw new Error("无法创建渲染页");
  }
}

async function handleRenderReady(msg: RenderReadyMessage, tabId?: number): Promise<void> {
  const pending = pendingPdf;
  console.log("[p2r][sw] 收到 render-ready，taskId=", msg.taskId, "tabId=", tabId, "有 pending=", Boolean(pending), "pending.taskId=", pending?.taskId);
  if (!pending || pending.taskId !== msg.taskId) {
    console.log("[p2r][sw] ⚠️ pendingPdf 为空或 taskId 不匹配，静默丢弃 render-ready（任务会卡住）");
    return;
  }
  if (tabId == null) throw new Error("渲染页无 tab id");
  try {
    console.log("[p2r][sw] 开始 streamPageToPdf，tabId=", tabId);
    const byteLength = await streamPageToPdf(tabId, (chunk) => writeChunk(pending, chunk));
    console.log("[p2r][sw] streamPageToPdf 完成，字节=", byteLength);
    if (!byteLength) throw new Error("PDF 为空");
    if (pendingPdf?.taskId !== pending.taskId) throw new Error("导出已中断");
    const res: PdfResultMessage = {
      type: "pdf-result",
      taskId: msg.taskId,
      byteLength,
      failedImages: msg.failedImages,
    };
    pending.port.postMessage(res);
  } catch (err) {
    console.log("[p2r][sw] streamPageToPdf 出错:", err instanceof Error ? err.message : err);
    const res: PdfErrorMessage = {
      type: "pdf-error",
      taskId: msg.taskId,
      error: err instanceof Error ? err.message : String(err),
    };
    try {
      pending.port.postMessage(res);
    } catch {
      /* 管道已断开 */
    }
  } finally {
    pendingPdf = null;
    await chrome.storage.session.remove(msg.taskId).catch(() => undefined);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function writeChunk(
  pending: { taskId: string; port: chrome.runtime.Port; ack: { resolve: () => void; reject: (e: Error) => void } | null },
  bytes: Uint8Array,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.ack = null;
      reject(new Error("写入 PDF 超时"));
    }, 60_000);
    pending.ack = {
      resolve: () => {
        clearTimeout(timer);
        pending.ack = null;
        resolve();
      },
      reject: (e) => {
        clearTimeout(timer);
        pending.ack = null;
        reject(e);
      },
    };
    try {
      pending.port.postMessage({ type: "pdf-chunk", taskId: pending.taskId, data: bytesToBase64(bytes) });
    } catch (err) {
      clearTimeout(timer);
      pending.ack = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function finishTask(): void {
  console.log("[p2r][sw] finishTask：释放 offscreenBusy、关闭 offscreen、pump");
  offscreenBusy = false;
  void chrome.offscreen.closeDocument().catch(() => undefined);
  pump();
}

function handlePortMessage(msg: unknown, port: chrome.runtime.Port): void {
  const m = msg as { type?: string; taskId?: string; status?: string; error?: string; note?: string };
  if (!m?.type) return;
  console.log("[p2r][sw] 收到端口消息:", m.type, "taskId=", m.taskId, "status=", m.status ?? "", "note=", m.note ?? "", "error=", m.error ?? "");
  if (m.type === "pdf-chunk-ack") {
    const ack = pendingPdf && pendingPdf.taskId === m.taskId ? pendingPdf.ack : null;
    const error = (m as { error?: string }).error;
    if (error) ack?.reject(new Error(error));
    else ack?.resolve();
    return;
  }
  if (m.type === "request-pdf") {
    handleRequestPdf(m as unknown as RequestPdfMessage, port).catch((err) => {
      console.log("[p2r][sw] handleRequestPdf 出错:", err instanceof Error ? err.message : err);
      const res: PdfErrorMessage = {
        type: "pdf-error",
        taskId: (m as { taskId: string }).taskId,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(res);
    });
    return;
  }
  if (m.type === "progress") {
    const p = m as unknown as ProgressMessage;
    void updateTaskStatus(p.taskId, { status: p.status, progressNote: p.note ?? null });
    return;
  }
  if (m.type === "done") {
    const d = m as unknown as DoneMessage;
    console.log("[p2r][sw] 任务完成 done，status=", d.status);
    void updateTaskStatus(d.taskId, {
      status: d.status,
      finishedAt: nowIso(),
      warnings: d.warnings,
      files: d.files,
      error: null,
      progressNote: null,
    }).then(finishTask);
    return;
  }
  if (m.type === "failed") {
    const f = m as unknown as FailedMessage;
    console.log("[p2r][sw] 任务失败 failed:", f.error);
    void updateTaskStatus(f.taskId, {
      status: "failed",
      finishedAt: nowIso(),
      error: f.error,
      progressNote: null,
    }).then(finishTask);
    return;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pipeline") return;
  console.log("[p2r][sw] pipeline 端口已连接");
  pipelinePort = port;
  port.onMessage.addListener((msg) => handlePortMessage(msg, port));
  port.onDisconnect.addListener(() => {
    console.log("[p2r][sw] pipeline 端口已断开");
    if (pipelinePort === port) pipelinePort = null;
    if (pendingPdf?.port === port) {
      pendingPdf.ack?.reject(new Error("导出已中断"));
      pendingPdf = null;
    }
  });
  if (pendingRun) {
    const run = pendingRun;
    pendingRun = null;
    console.log("[p2r][sw] 投递 pending run");
    port.postMessage(run);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as { type?: string };
  if (msg.type === "submit") {
    handleSubmit(message as SubmitMessage)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === "get-task-list") {
    listTasks().then(sendResponse);
    return true;
  }
  if (msg.type === "render-ready") {
    handleRenderReady(message as RenderReadyMessage, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err: Error) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === "render-failed") {
    const m = message as { taskId?: string; error?: string };
    console.log("[p2r][sw] 收到 render-failed，taskId=", m.taskId, "err=", m.error);
    const pending = pendingPdf;
    if (pending && pending.taskId === m.taskId) {
      pending.port.postMessage({
        type: "pdf-error",
        taskId: m.taskId,
        error: m.error || "渲染页失败",
      });
      pendingPdf = null;
      void chrome.storage.session.remove(m.taskId ?? "").catch(() => undefined);
      if (sender.tab?.id != null) void chrome.tabs.remove(sender.tab.id).catch(() => undefined);
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
