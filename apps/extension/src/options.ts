import { DEFAULT_SETTINGS, loadSettings } from "./settings";

const baseUrl = document.getElementById("baseUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const status = document.getElementById("status")!;

loadSettings().then((settings: { baseUrl: string; token: string }) => {
  baseUrl.value = settings.baseUrl || DEFAULT_SETTINGS.baseUrl;
  token.value = settings.token || "";
});

document.getElementById("save")!.addEventListener("click", async () => {
  await chrome.storage.local.set({
    baseUrl: baseUrl.value.trim() || DEFAULT_SETTINGS.baseUrl,
    token: token.value.trim(),
  });
  status.textContent = "已保存";
});
