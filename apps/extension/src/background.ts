import {
  type DoneMessage,
  type FailedMessage,
  type PdfErrorMessage,
  type PdfResultMessage,
  type RenderReadyMessage,
  type RequestPdfMessage,
  type RunMessage,
  type SubmitMessage,
  type TaskRecord,
} from "./types.js";
import { normalizeUrl, nowIso } from "./lib/util.js";
import { listTasks, loadSettings, upsertTask } from "./lib/storage.js";
import { printPageToPdf } from "./lib/pdf.js";

// ---- offscreen 管道状态 ----
let pipelinePort: chrome.runtime.Port | null = null;
let pendingRun: RunMessage | null = null;
let pendingPdf: { taskId: string; port: chrome.runtime.Port; fileName: string } | null = null;
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
  await updateTaskStatus(taskId, { status: "rendering" });
  await chrome.storage.session.set({ [taskId]: { html } });
  pendingPdf = { taskId, port, fileName };

  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`render.html?task=${encodeURIComponent(taskId)}`),
    active: false,
  });
  if (tab.id == null) {
    pendingPdf = null;
    throw new Error("无法创建渲染页");
  }
}

async function handleRenderReady(msg: RenderReadyMessage, tabId?: number): Promise<void> {
  const pending = pendingPdf;
  if (!pending || pending.taskId !== msg.taskId) return;
  if (tabId == null) throw new Error("渲染页无 tab id");
  try {
    const base64 = await printPageToPdf(tabId);
    const res: PdfResultMessage = { type: "pdf-result", taskId: msg.taskId, base64, failedImages: msg.failedImages };
    pending.port.postMessage(res);
  } catch (err) {
    const res: PdfErrorMessage = {
      type: "pdf-error",
      taskId: msg.taskId,
      error: err instanceof Error ? err.message : String(err),
    };
    pending.port.postMessage(res);
  } finally {
    pendingPdf = null;
    await chrome.storage.session.remove(msg.taskId).catch(() => undefined);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function finishTask(): void {
  offscreenBusy = false;
  void chrome.offscreen.closeDocument().catch(() => undefined);
  pump();
}

function handlePortMessage(msg: unknown, port: chrome.runtime.Port): void {
  const m = msg as { type?: string; taskId?: string };
  if (!m?.type) return;
  if (m.type === "request-pdf") {
    handleRequestPdf(m as unknown as RequestPdfMessage, port).catch((err) => {
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
    void updateTaskStatus(m.taskId!, { status: (m as { status: TaskRecord["status"] }).status });
    return;
  }
  if (m.type === "done") {
    const d = m as unknown as DoneMessage;
    void updateTaskStatus(d.taskId, {
      status: d.status,
      finishedAt: nowIso(),
      warnings: d.warnings,
      files: d.files,
      error: null,
    }).then(finishTask);
    return;
  }
  if (m.type === "failed") {
    const f = m as unknown as FailedMessage;
    void updateTaskStatus(f.taskId, { status: "failed", finishedAt: nowIso(), error: f.error }).then(finishTask);
    return;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pipeline") return;
  pipelinePort = port;
  port.onMessage.addListener((msg) => handlePortMessage(msg, port));
  port.onDisconnect.addListener(() => {
    if (pipelinePort === port) pipelinePort = null;
    if (pendingPdf?.port === port) pendingPdf = null;
  });
  if (pendingRun) {
    const run = pendingRun;
    pendingRun = null;
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
