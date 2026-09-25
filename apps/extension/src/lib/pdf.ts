// chrome.debugger + CDP Page.printToPDF：把已渲染好的 tab 打印成 A4 PDF。
import { createBase64Decoder } from "./base64-chunks.js";

const FOOTER_TEMPLATE =
  '<div style="width:100%;font-size:9px;color:#888;padding:0 20mm 6px 20mm;text-align:right;font-family:system-ui,sans-serif;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>';

const IO_READ_CHUNK_BYTES = 2 * 1024 * 1024; // 每次读 2MB

function attach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.0", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function sendCommand(
  tabId: number,
  method: string,
  params?: object,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`调试器命令超时：${method}`)), timeoutMs);
    chrome.debugger.sendCommand({ tabId }, method, params as never, (result) => {
      clearTimeout(timer);
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

const MAX_PDF_BYTES = 200 * 1024 * 1024;

/** 按块读取 printToPDF 流，解码后交给 onChunk，不保留整份 PDF。返回字节数。 */
async function readStream(
  tabId: number,
  handle: string,
  onChunk: (bytes: Uint8Array) => Promise<void>,
): Promise<number> {
  const decode = createBase64Decoder();
  let total = 0;
  for (let i = 0; i < 10_000; i++) {
    const r = await sendCommand(tabId, "IO.read", { handle, size: IO_READ_CHUNK_BYTES });
    const data = typeof r?.data === "string" ? r.data : "";
    const eof = Boolean(r?.eof);
    const base64 = r?.base64Encoded !== false;
    let bytes: Uint8Array | null = null;
    if (data || eof) {
      if (base64) bytes = decode.push(data, eof);
      else if (data) {
        bytes = new Uint8Array(data.length);
        for (let n = 0; n < data.length; n++) bytes[n] = data.charCodeAt(n);
      }
    }
    if (bytes?.byteLength) {
      total += bytes.byteLength;
      if (total > MAX_PDF_BYTES) throw new Error("PDF 超过 200MB，已中止");
      await onChunk(bytes);
    }
    if (eof) break;
    if (!data) throw new Error("printToPDF 流在结束前中断");
  }
  console.log("[p2r][pdf] readStream 完成，字节=", total);
  return total;
}

/** attach → Page.enable → printToPDF（ReturnAsStream）→ 分块回调 → detach。 */
export async function streamPageToPdf(
  tabId: number,
  onChunk: (bytes: Uint8Array) => Promise<void>,
): Promise<number> {
  console.log("[p2r][pdf] attach debugger，tabId=", tabId);
  await attach(tabId);
  console.log("[p2r][pdf] debugger 已 attach");
  try {
    await sendCommand(tabId, "Page.enable");
    const result = await sendCommand(tabId, "Page.printToPDF", {
      transferMode: "ReturnAsStream",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER_TEMPLATE,
    }, 180_000);
    console.log("[p2r][pdf] printToPDF 命令返回，stream=", typeof result?.stream === "string" ? result.stream : "无");
    const stream = typeof result?.stream === "string" ? result.stream : "";
    if (!stream) throw new Error("printToPDF 未返回 stream");
    try {
      return await readStream(tabId, stream, onChunk);
    } finally {
      await sendCommand(tabId, "IO.close", { handle: stream }, 10_000).catch(() => undefined);
    }
  } finally {
    await detach(tabId);
    console.log("[p2r][pdf] debugger 已 detach");
  }
}
