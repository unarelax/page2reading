type Mode = "original" | "bilingual";

const titleEl = document.getElementById("title")!;
const statusEl = document.getElementById("status")!;
const originalBtn = document.getElementById("original") as HTMLButtonElement;
const bilingualBtn = document.getElementById("bilingual") as HTMLButtonElement;

function setStatus(text: string) {
  statusEl.textContent = text;
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
    const res = await chrome.runtime.sendMessage({
      type: "submit",
      mode,
      url: page.url,
      pageTitle: page.pageTitle,
      html: page.html,
    });
    if (res?.error) throw new Error(res.error);
    if (res?.duplicate) {
      setStatus("这篇文章已经导出过。如需重做，可在本地服务重试该任务。");
      return;
    }
    setStatus(`已加入队列：${res?.taskId ?? ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Failed to fetch|NetworkError|本地服务/.test(message)) {
      setStatus("提交失败：本地服务未启动。请先运行 npm run serve");
    } else {
      setStatus(message);
    }
  } finally {
    originalBtn.disabled = false;
    bilingualBtn.disabled = false;
  }
}

currentTab()
  .then((tab) => {
    titleEl.textContent = tab.title || tab.url || "当前页面";
  })
  .catch((err: Error) => setStatus(err.message));

originalBtn.addEventListener("click", () => submit("original"));
bilingualBtn.addEventListener("click", () => submit("bilingual"));
