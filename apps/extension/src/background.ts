import {
  type CancelPdfMessage,
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
import { normalizeUrl, nowIso, OFFSCREEN_CONNECT_TIMEOUT_MS } from "./lib/util.js";
import { failInflightTasks, listTasks, loadSettings, upsertTask } from "./lib/storage.js";
import { bytesToBase64 } from "./lib/base64-chunks.js";
import { streamPageToPdf } from "./lib/pdf.js";
import { createRunDispatch } from "./lib/run-dispatch.js";
import { createSerialQueue } from "./lib/serial.js";
import { INTERRUPTED_MESSAGE, mergeTaskPatch } from "./lib/task-status.js";

const dispatch = createRunDispatch<RunMessage>();
const enqueue = createSerialQueue();

void enqueue(() => failInflightTasks(nowIso()))
  .then((n) => {
    if (n) console.log("[p2r][sw] 已将中断任务标为失败", n);
  })
  .catch((err) => {
    console.log("[p2r][sw] 恢复中断任务失败", err instanceof Error ? err.message : err);
  });

interface PendingPdf {
  taskId: string;
  port: chrome.runtime.Port;
  fileName: string;
  tabId: number | null;
  ack: { resolve: () => void; reject: (e: Error) => void } | null;
}

let pendingPdf: PendingPdf | null = null;
let runQueue: RunMessage[] = [];
let offscreenBusy = false;
let activeTaskId: string | null = null;
let activeToken = 0;
let runToken = 0;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

function clearConnectTimer(): void {
  if (connectTimer != null) clearTimeout(connectTimer);
  connectTimer = null;
}

function safePost(port: { postMessage(message: unknown): void } | null | undefined, message: unknown): void {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch {
    /* 端口已断开 */
  }
}

function tokenFromPort(port: chrome.runtime.Port): number | null {
  const raw = port.sender?.url;
  if (!raw) return null;
  try {
    const run = new URL(raw).searchParams.get("run");
    if (!run) return null;
    const n = Number(run);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

async function ensureOffscreen(token: number): Promise<void> {
  // 每个任务重建 offscreen。closeDocument resolve 之后旧 port 仍可能短暂留在变量里，必须先作废。
  await chrome.offscreen.closeDocument().catch(() => undefined);
  dispatch.invalidatePort();
  try {
    await chrome.offscreen.createDocument({
      url: `offscreen.html?run=${token}`,
      reasons: ["BLOBS" as chrome.offscreen.Reason],
      justification: "翻译 + 渲染 HTML + 通过 File System Access API 写入 Markdown/PDF 文件",
    });
  } catch (err) {
    if (!(err instanceof Error) || !/single offscreen/i.test(err.message)) throw err;
  }
}

function armConnectTimer(run: RunMessage, token: number): void {
  clearConnectTimer();
  connectTimer = setTimeout(() => {
    if (token !== activeToken) return;
    if (dispatch.pending?.taskId !== run.taskId) return;
    console.log("[p2r][sw] offscreen 未连上，放弃任务", run.taskId);
    dispatch.clearPendingIf((m) => m.taskId === run.taskId);
    void failAndFinish(run.taskId, token, "导出通道未连上，请重试");
  }, OFFSCREEN_CONNECT_TIMEOUT_MS);
}

async function startRun(run: RunMessage, token: number): Promise<void> {
  try {
    await ensureOffscreen(token);
    if (token !== activeToken) return;
    const state = dispatch.deliver(run);
    if (token !== activeToken) return;
    console.log("[p2r][sw] 投递 run", run.taskId, state);
    if (state === "waiting") armConnectTimer(run, token);
    else clearConnectTimer();
  } catch (err) {
    if (token !== activeToken) return;
    const error = err instanceof Error ? err.message : String(err);
    console.log("[p2r][sw] 启动 offscreen 失败:", error);
    await failAndFinish(run.taskId, token, error);
  }
}

function pump(): void {
  if (offscreenBusy) return;
  const run = runQueue.shift();
  if (!run) return;
  offscreenBusy = true;
  const token = ++runToken;
  activeToken = token;
  activeTaskId = run.taskId;
  void startRun(run, token);
}

function finishTask(token: number): void {
  if (token === 0 || token !== activeToken) return;
  activeToken = 0;
  clearConnectTimer();
  if (activeTaskId) dispatch.clearPendingIf((m) => m.taskId === activeTaskId);
  offscreenBusy = false;
  activeTaskId = null;
  dispatch.invalidatePort();
  console.log("[p2r][sw] finishTask：释放 offscreenBusy、关闭 offscreen、pump");
  void chrome.offscreen.closeDocument().catch(() => undefined);
  pump();
}

function updateTaskStatus(id: string, patch: Partial<TaskRecord>): Promise<void> {
  return enqueue(async () => {
    const tasks = await listTasks();
    const current = tasks.find((t) => t.id === id);
    if (!current) return;
    const merged = mergeTaskPatch(current, patch);
    if (!merged) return;
    await upsertTask(merged);
  });
}

function settle(taskId: string, token: number, patch: Partial<TaskRecord>): void {
  void updateTaskStatus(taskId, patch).finally(() => {
    if (activeTaskId !== taskId || token !== activeToken) return;
    void discardPdf(taskId);
    finishTask(token);
  });
}

async function failAndFinish(taskId: string, token: number, error: string): Promise<void> {
  if (token !== activeToken) return;
  clearConnectTimer();
  dispatch.clearPendingIf((m) => m.taskId === taskId);
  await discardPdf(taskId);
  try {
    await updateTaskStatus(taskId, {
      status: "failed",
      finishedAt: nowIso(),
      error,
      progressNote: null,
    });
  } catch (err) {
    console.log("[p2r][sw] 写入失败状态出错", err instanceof Error ? err.message : err);
  } finally {
    finishTask(token);
  }
}

function takePdf(taskId?: string): PendingPdf | null {
  const pending = pendingPdf;
  if (!pending) return null;
  if (taskId != null && pending.taskId !== taskId) return null;
  pendingPdf = null;
  return pending;
}

async function discardPdf(taskId?: string): Promise<void> {
  const pending = takePdf(taskId);
  if (!pending) return;
  console.log("[p2r][sw] 关闭渲染页，taskId=", pending.taskId, "tabId=", pending.tabId);
  pending.ack?.reject(new Error("导出已中断"));
  await chrome.storage.session.remove(pending.taskId).catch(() => undefined);
  if (pending.tabId != null) await chrome.tabs.remove(pending.tabId).catch(() => undefined);
}

async function handleSubmit(msg: SubmitMessage) {
  const settings = await loadSettings();
  if (msg.mode === "bilingual" && !settings.apiKey) {
    throw new Error("请先在设置页配置 DeepSeek API Key");
  }

  const normalizedUrl = normalizeUrl(msg.url);
  const taskId = crypto.randomUUID();
  const collectedAt = nowIso();
  const record: TaskRecord = {
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
  };
  await enqueue(() => upsertTask(record));

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
  if (pendingPdf && pendingPdf.taskId !== taskId) await discardPdf(pendingPdf.taskId);
  pendingPdf = { taskId, port, fileName, tabId: null, ack: null };
  try {
    await updateTaskStatus(taskId, { status: "rendering", progressNote: null });
    await chrome.storage.session.set({ [taskId]: { html } });
    if (pendingPdf?.taskId !== taskId) return;
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`render.html?task=${encodeURIComponent(taskId)}`),
      active: false,
    });
    console.log("[p2r][sw] render 标签页已创建，tabId=", tab.id);
    if (pendingPdf?.taskId !== taskId) {
      if (tab.id != null) await chrome.tabs.remove(tab.id).catch(() => undefined);
      return;
    }
    if (tab.id == null) throw new Error("无法创建渲染页");
    pendingPdf.tabId = tab.id;
  } catch (err) {
    await discardPdf(taskId);
    throw err;
  }
}

async function handleRenderReady(msg: RenderReadyMessage, tabId?: number): Promise<void> {
  const pending = pendingPdf;
  console.log("[p2r][sw] 收到 render-ready，taskId=", msg.taskId, "tabId=", tabId, "有 pending=", Boolean(pending), "pending.taskId=", pending?.taskId);
  if (!pending || pending.taskId !== msg.taskId) {
    console.log("[p2r][sw] render-ready 无匹配会话，关闭渲染页");
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => undefined);
    safePost(dispatch.port, { type: "pdf-error", taskId: msg.taskId, error: "渲染页已失效" } satisfies PdfErrorMessage);
    return;
  }
  if (tabId == null) {
    safePost(pending.port, { type: "pdf-error", taskId: msg.taskId, error: "渲染页无 tab id" } satisfies PdfErrorMessage);
    await discardPdf(msg.taskId);
    return;
  }
  if (pending.tabId == null) pending.tabId = tabId;
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
    safePost(pending.port, res);
  } finally {
    if (pendingPdf?.taskId === msg.taskId) pendingPdf = null;
    await chrome.storage.session.remove(msg.taskId).catch(() => undefined);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function writeChunk(pending: PendingPdf, bytes: Uint8Array): Promise<void> {
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
  if (m.type === "cancel-pdf") {
    const c = m as unknown as CancelPdfMessage;
    void discardPdf(c.taskId);
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
      safePost(port, res);
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
    settle(d.taskId, activeToken, {
      status: d.status,
      finishedAt: nowIso(),
      warnings: d.warnings,
      files: d.files,
      error: null,
      progressNote: null,
    });
    return;
  }
  if (m.type === "failed") {
    const f = m as unknown as FailedMessage;
    console.log("[p2r][sw] 任务失败 failed:", f.error);
    settle(f.taskId, activeToken, {
      status: "failed",
      finishedAt: nowIso(),
      error: f.error,
      progressNote: null,
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "pipeline") return;
  const token = tokenFromPort(port);
  if (token != null && token !== activeToken) {
    console.log("[p2r][sw] 忽略过期 offscreen 连接，run=", token);
    return;
  }
  console.log("[p2r][sw] pipeline 端口已连接");
  dispatch.setPort(port);
  port.onMessage.addListener((msg) => handlePortMessage(msg, port));
  port.onDisconnect.addListener(() => {
    console.log("[p2r][sw] pipeline 端口已断开");
    const wasCurrent = dispatch.port === port;
    if (wasCurrent) dispatch.invalidatePort();
    if (pendingPdf?.port === port) void discardPdf(pendingPdf.taskId);
    const taskId = activeTaskId;
    const run = activeToken;
    if (wasCurrent && offscreenBusy && taskId && run) {
      void failAndFinish(taskId, run, INTERRUPTED_MESSAGE);
    }
  });
  try {
    const state = dispatch.flush();
    if (state === "sent") clearConnectTimer();
    if (state === "sent") console.log("[p2r][sw] onConnect 投递 pending run");
  } catch (err) {
    const pending = dispatch.pending;
    console.log("[p2r][sw] onConnect 投递失败:", err instanceof Error ? err.message : err);
    if (pending && activeTaskId === pending.taskId) {
      dispatch.clearPendingIf((m) => m.taskId === pending.taskId);
      void failAndFinish(pending.taskId, activeToken, err instanceof Error ? err.message : String(err));
    }
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
    enqueue(() => listTasks())
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ error: err.message }));
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
      safePost(pending.port, {
        type: "pdf-error",
        taskId: m.taskId,
        error: m.error || "渲染页失败",
      } satisfies PdfErrorMessage);
      void discardPdf(m.taskId);
    } else if (sender.tab?.id != null) {
      void chrome.tabs.remove(sender.tab.id).catch(() => undefined);
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
