import type { SubmitMessage, TaskRecord, TaskStatus } from "./types.js";

type Mode = "original" | "bilingual";

const titleEl = document.getElementById("title")!;
const statusEl = document.getElementById("status")!;
const originalBtn = document.getElementById("original") as HTMLButtonElement;
const bilingualBtn = document.getElementById("bilingual") as HTMLButtonElement;
const tasksEl = document.getElementById("tasks")!;

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
    setStatus("导出中，需保持浏览器开着，保持网络连接");
    await refreshTasks();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    originalBtn.disabled = false;
    bilingualBtn.disabled = false;
  }
}

async function refreshTasks() {
  const tasks = (await chrome.runtime.sendMessage({ type: "get-task-list" })) as TaskRecord[];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    tasksEl.innerHTML = "";
    return;
  }
  tasksEl.innerHTML = tasks
    .slice(0, 8)
    .map((t) => {
      const title = t.pageTitle || t.url;
      const kind = taskKind(t.status);
      const action =
        kind === "retry"
          ? `<button type="button" class="task-action" data-url="${escapeHtml(t.url)}">重试</button>`
          : `<span class="task-status">${kind === "ok" ? "成功" : "导出中"}</span>`;
      return `<div class="task" title="${escapeHtml(t.url)}"><span class="dot ${kind}"></span><span class="task-title">${escapeHtml(title)}</span>${action}</div>`;
    })
    .join("");
}

currentTab()
  .then((tab) => {
    titleEl.textContent = tab.title || tab.url || "当前页面";
  })
  .catch((err: Error) => setStatus(err.message));

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
