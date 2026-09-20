import { DEFAULT_SETTINGS, type ExportMode, type ExtensionSettings, type TaskRecord } from "../types.js";

const TASKS_KEY = "tasks";
const MAX_TASKS = 50;

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
  return Array.isArray(arr) ? (arr as TaskRecord[]) : [];
}

export async function upsertTask(task: TaskRecord): Promise<void> {
  const tasks = await listTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  await chrome.storage.local.set({ [TASKS_KEY]: tasks.slice(0, MAX_TASKS) });
}

export async function findSucceeded(
  normalizedUrl: string,
  mode: ExportMode,
): Promise<TaskRecord | null> {
  const tasks = await listTasks();
  return (
    tasks.find(
      (t) => t.normalizedUrl === normalizedUrl && t.mode === mode && t.status === "succeeded",
    ) ?? null
  );
}
