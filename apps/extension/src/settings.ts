import { DEFAULT_SETTINGS } from "./types.js";
import { loadSettings, saveSettings } from "./lib/storage.js";
import { getDirHandle, getDirStatus, saveDirHandle } from "./lib/fs.js";

const apiKeyInput = document.getElementById("apiKey") as HTMLInputElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const dirBtn = document.getElementById("pick-dir") as HTMLButtonElement;
const dirStatusEl = document.getElementById("dir-status")!;
const reauthBtn = document.getElementById("reauth") as HTMLButtonElement;

async function refreshDir(): Promise<void> {
  const status = await getDirStatus();
  if (!status.configured) {
    dirStatusEl.textContent = "尚未选择保存目录";
    reauthBtn.style.display = "none";
    return;
  }
  const suffix = status.permission === "granted" ? "" : "（需重新授权）";
  dirStatusEl.textContent = `保存目录：${status.name}${suffix}`;
  reauthBtn.style.display = status.permission === "prompt" ? "inline-block" : "none";
}

async function init(): Promise<void> {
  const s = await loadSettings();
  apiKeyInput.value = s.apiKey;
  modelSelect.value = s.model || DEFAULT_SETTINGS.model;
  await refreshDir();
}

dirBtn.addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ id: "p2r-root", mode: "readwrite" });
    await saveDirHandle(handle);
    await refreshDir();
  } catch (err) {
    if ((err as Error).name === "AbortError") return; // 用户取消
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  }
});

reauthBtn.addEventListener("click", async () => {
  const handle = await getDirHandle();
  if (!handle) return;
  const state = await handle.requestPermission({ mode: "readwrite" });
  if (state === "granted") await refreshDir();
  else statusEl.textContent = "未能获取写权限";
});

saveBtn.addEventListener("click", async () => {
  await saveSettings({ apiKey: apiKeyInput.value.trim(), model: modelSelect.value });
  statusEl.textContent = "已保存";
});

void init();
