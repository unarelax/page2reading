import type { SubmitMessage, TaskRecord, TaskStatus } from "./types.js";

type Mode = "original" | "bilingual";

const titleEl = document.getElementById("title")!;
const statusEl = document.getElementById("status")!;
const originalBtn = document.getElementById("original") as HTMLButtonElement;
const bilingualBtn = document.getElementById("bilingual") as HTMLButtonElement;
const tasksEl = document.getElementById("tasks")!;

let followTaskId: string | null = null;
let statusLocked = false;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function taskKind(status: TaskStatus): "exporting" | "ok" | "retry" {
  if (status === "succeeded" || status === "succeeded_with_warnings") return "ok";
  if (status === "failed") return "retry";
  return "exporting";
}

function liveLabel(t: TaskRecord): string {
  switch (t.status) {
    case "queued":
      return "排队中";
    case "extracting":
      return "提取正文";
    case "translating":
      return t.progressNote ? `翻译中 ${t.progressNote}` : "翻译中";
    case "rendering":
      return "生成 PDF";
    case "succeeded":
    case "succeeded_with_warnings":
      return "成功";
    case "failed":
      return t.error || "失败";
  }
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("没有可用的标签页");
  if (!/^https?:/.test(tab.url)) throw new Error("只能导出 http/https 文章页");
  return tab;
}

async function capture(tabId: number) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      pageTitle: document.title,
      html: document.documentElement.outerHTML,
    }),
  });
  const result = injection?.result;
  if (!result?.html) throw new Error("无法读取页面 HTML");
  return result;
}

async function submit(mode: Mode) {
  originalBtn.disabled = true;
  bilingualBtn.disabled = true;
  statusLocked = false;
  try {
    const tab = await currentTab();
    const page = await capture(tab.id!);
    const res = (await chrome.runtime.sendMessage({
      type: "submit",
      mode,
      url: page.url,
      pageTitle: page.pageTitle,
      html: page.html,
    } satisfies SubmitMessage)) as { error?: string; taskId?: string };
    if (res?.error) throw new Error(res.error);
    followTaskId = res.taskId ?? null;
    setStatus("已加入队列，长文对照可能需要十几分钟");
    await refreshTasks();
  } catch (err) {
    statusLocked = true;
    followTaskId = null;
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    originalBtn.disabled = false;
    bilingualBtn.disabled = false;
  }
}

function syncBanner(tasks: TaskRecord[]): void {
  if (statusLocked) return;
  const inflight = tasks.find((t) => taskKind(t.status) === "exporting");
  if (inflight) {
    followTaskId = inflight.id;
    setStatus(`${liveLabel(inflight)}，请保持网络连接`);
    return;
  }
  if (!followTaskId) return;
  const t = tasks.find((x) => x.id === followTaskId);
  followTaskId = null;
  if (!t) return;
  if (t.status === "failed") setStatus(t.error || "导出失败");
  else setStatus(t.warnings?.length ? `已完成（${t.warnings[0]}）` : "导出完成");
}

async function refreshTasks() {
  const tasks = (await chrome.runtime.sendMessage({ type: "get-task-list" })) as TaskRecord[];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    tasksEl.innerHTML = "";
    return;
  }
  syncBanner(tasks);
  tasksEl.innerHTML = tasks
    .slice(0, 8)
    .map((t) => {
      const title = t.pageTitle || t.url;
      const kind = taskKind(t.status);
      const tooltip = t.error ? `${t.url}\n${t.error}` : t.url;
      const action =
        kind === "retry"
          ? `<button type="button" class="task-action" data-url="${escapeHtml(t.url)}">重试</button>`
          : `<span class="task-status">${kind === "ok" ? "成功" : liveLabel(t)}</span>`;
      return `<div class="task" title="${escapeHtml(tooltip)}"><span class="dot ${kind}"></span><span class="task-title">${escapeHtml(title)}</span>${action}</div>`;
    })
    .join("");
}

currentTab()
  .then((tab) => {
    titleEl.textContent = tab.title || tab.url || "当前页面";
  })
  .catch((err: Error) => {
    statusLocked = true;
    setStatus(err.message);
  });

refreshTasks().catch(() => undefined);
setInterval(() => {
  refreshTasks().catch(() => undefined);
}, 1500);

tasksEl.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button.task-action");
  if (!(btn instanceof HTMLButtonElement)) return;
  const url = btn.dataset.url;
  if (!url || !/^https?:/.test(url)) return;
  void chrome.tabs.create({ url });
});

originalBtn.addEventListener("click", () => submit("original"));
bilingualBtn.addEventListener("click", () => submit("bilingual"));
