// PDF 渲染页：把 offscreen 生成的 HTML 渲染进本页，等图加载完通知 SW 打印。
const IMAGE_LOAD_TIMEOUT_MS = 15_000;

async function waitForImages(timeoutMs: number): Promise<string[]> {
  const failed: string[] = [];
  const imgs = Array.from(document.images);
  const deadline = Date.now() + timeoutMs;
  for (const img of imgs) {
    const remaining = Math.max(300, deadline - Date.now());
    if (img.complete && img.naturalWidth > 0) continue;
    if (img.complete && img.naturalWidth === 0 && img.src) {
      const src = img.src;
      img.src = "";
      img.src = src;
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      }),
      new Promise<void>((resolve) => setTimeout(resolve, remaining)),
    ]);
    if (!(img.complete && img.naturalWidth > 0)) failed.push(img.currentSrc || img.src);
  }
  return failed;
}

async function main(): Promise<void> {
  const taskId = new URLSearchParams(location.search).get("task");
  if (!taskId) throw new Error("缺少 task 参数");

  const stored = (await chrome.storage.session.get(taskId)) as { [k: string]: { html?: string } };
  const html = stored[taskId]?.html;
  if (!html) throw new Error("渲染内容不存在");

  // 注入整篇 HTML：先 head（样式 + referrer meta），再 body 内容，确保后续图片加载遵循 referrer 策略。
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const node of Array.from(parsed.head.childNodes)) {
    document.head.appendChild(node.cloneNode(true));
  }
  document.body.setAttribute("class", parsed.body.getAttribute("class") ?? "");
  document.body.innerHTML = parsed.body.innerHTML;

  const failedImages = await waitForImages(IMAGE_LOAD_TIMEOUT_MS);
  await chrome.runtime.sendMessage({ type: "render-ready", taskId, failedImages });
}

main().catch((err: Error) => {
  const taskId = new URLSearchParams(location.search).get("task");
  void chrome.runtime.sendMessage({
    type: "render-failed",
    taskId,
    error: err.message,
  });
});
