import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, createBase64Decoder } from "./base64-chunks.js";

describe("base64 chunks", () => {
  it("来回转换超过单次 spread 上限的字节", () => {
    const bytes = new Uint8Array(40_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("分片解码把不满 4 字符的尾巴留给下一块", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 10, 20, 30, 40, 50]);
    const encoded = bytesToBase64(bytes);
    const decoder = createBase64Decoder();
    const head = decoder.push(encoded.slice(0, 5), false);
    const tail = decoder.push(encoded.slice(5), true);
    const merged = new Uint8Array((head?.length ?? 0) + (tail?.length ?? 0));
    if (head) merged.set(head, 0);
    if (tail) merged.set(tail, head?.length ?? 0);
    expect(merged).toEqual(bytes);
  });
});
