import { DEFAULT_SETTINGS, type ExtensionSettings, type TaskRecord } from "../types.js";
import { settleInterrupted } from "./task-status.js";

const TASKS_KEY = "tasks";
const MAX_TASKS = 50;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(task: TaskRecord): boolean {
  const t = Date.parse(task.createdAt);
  return !Number.isNaN(t) && Date.now() - t < TASK_TTL_MS;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(["apiKey", "model"]);
  return {
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
    model: typeof stored.model === "string" && stored.model ? stored.model : DEFAULT_SETTINGS.model,
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ apiKey: settings.apiKey, model: settings.model });
}

export async function listTasks(): Promise<TaskRecord[]> {
  const stored = await chrome.storage.local.get(TASKS_KEY);
  const arr = stored[TASKS_KEY];
  const tasks = Array.isArray(arr) ? (arr as TaskRecord[]) : [];
  const fresh = tasks.filter(isFresh);
  if (fresh.length !== tasks.length) {
    await chrome.storage.local.set({ [TASKS_KEY]: fresh });
  }
  return fresh;
}

/** Service Worker 启动时调用：进行中的任务已经没有执行者了。 */
export async function failInflightTasks(finishedAt: string): Promise<number> {
  const tasks = await listTasks();
  const settled = settleInterrupted(tasks, finishedAt);
  if (!settled.changed) return 0;
  await chrome.storage.local.set({ [TASKS_KEY]: settled.tasks });
  return settled.tasks.reduce((n, task, i) => n + (task !== tasks[i] ? 1 : 0), 0);
}

export async function upsertTask(task: TaskRecord): Promise<void> {
  const tasks = await listTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  await chrome.storage.local.set({ [TASKS_KEY]: tasks.filter(isFresh).slice(0, MAX_TASKS) });
}
