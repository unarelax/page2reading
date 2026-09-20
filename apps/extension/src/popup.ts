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

function statusText(status: TaskStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "extracting":
      return "抽取中";
    case "translating":
      return "翻译中";
    case "rendering":
      return "生成 PDF";
    case "succeeded":
      return "完成";
    case "succeeded_with_warnings":
      return "完成（缺图）";
    case "failed":
      return "失败";
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
  setStatus("正在提交…");
  try {
    const tab = await currentTab();
    const page = await capture(tab.id!);
    const res = (await chrome.runtime.sendMessage({
      type: "submit",
      mode,
      url: page.url,
      pageTitle: page.pageTitle,
      html: page.html,
    } satisfies SubmitMessage)) as { error?: string; duplicate?: boolean; taskId?: string };
    if (res?.error) throw new Error(res.error);
    if (res?.duplicate) {
      setStatus("这篇文章已经导出过。");
      return;
    }
    setStatus(`已加入队列，可关闭本页。`);
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
      return `<div class="task" title="${escapeHtml(t.url)}"><span class="dot ${t.status}"></span><span class="task-title">${escapeHtml(title)}</span><span class="task-status">${statusText(t.status)}</span></div>`;
    })
    .join("");
}

currentTab()
  .then((tab) => {
    titleEl.textContent = tab.title || tab.url || "当前页面";
  })
  .catch((err: Error) => setStatus(err.message));

refreshTasks().catch(() => undefined);

originalBtn.addEventListener("click", () => submit("original"));
bilingualBtn.addEventListener("click", () => submit("bilingual"));
