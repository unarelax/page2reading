// chrome.debugger + CDP Page.printToPDF：把已渲染好的 tab 打印成 A4 PDF。

const FOOTER_TEMPLATE =
  '<div style="width:100%;font-size:9px;color:#888;padding:0 20mm 6px 20mm;text-align:right;font-family:system-ui,sans-serif;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>';

function attach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.0", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function sendCommand(tabId: number, method: string, params?: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params as never, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result as Record<string, unknown>);
    });
  });
}

function detach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

/** attach → Page.enable → printToPDF → detach，返回 PDF 的 base64。 */
export async function printPageToPdf(tabId: number): Promise<string> {
  await attach(tabId);
  try {
    await sendCommand(tabId, "Page.enable");
    const result = await sendCommand(tabId, "Page.printToPDF", {
      transferMode: "ReturnAsBase64",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER_TEMPLATE,
    });
    const data = result?.data;
    if (typeof data !== "string" || !data) throw new Error("printToPDF 未返回数据");
    return data;
  } finally {
    await detach(tabId);
  }
}
