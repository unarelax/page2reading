import { loadSettings } from "./settings";

type Mode = "original" | "bilingual";

interface SubmitMessage {
  type: "submit";
  url: string;
  pageTitle: string;
  html: string;
  mode: Mode;
}

chrome.runtime.onMessage.addListener((message: SubmitMessage, _sender, sendResponse) => {
  if (message.type !== "submit") return;
  submit(message)
    .then(sendResponse)
    .catch((err: Error) => sendResponse({ error: err.message }));
  return true;
});

async function submit(message: SubmitMessage) {
  const settings = await loadSettings();
  if (!settings.token) {
    throw new Error("尚未配置鉴权令牌，请先打开扩展选项页");
  }
  const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify({
      url: message.url,
      pageTitle: message.pageTitle,
      html: message.html,
      mode: message.mode,
      capturedAt: new Date().toISOString(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 0 || res.status >= 500) {
      throw new Error("本地服务未启动或出错");
    }
    throw new Error(typeof data.error === "string" ? data.error : `提交失败 (${res.status})`);
  }
  return data;
}
