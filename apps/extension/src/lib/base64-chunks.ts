const BTOA_STEP = 0x8000;

/** 扩展消息只保证能带走字符串，二进制要先变成 base64。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BTOA_STEP) {
    const slice = bytes.subarray(i, i + BTOA_STEP);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把可能被拆开的 base64 片段解成字节。不足 4 字符的尾巴留给下一块。 */
export function createBase64Decoder(): {
  push: (data: string, eof: boolean) => Uint8Array | null;
} {
  let extra = "";
  return {
    push(data: string, eof: boolean): Uint8Array | null {
      let s = extra + data.replace(/\s/g, "");
      extra = "";
      if (!eof) {
        const remain = s.length % 4;
        if (remain) {
          extra = s.slice(s.length - remain);
          s = s.slice(0, -remain);
        }
      } else if (s.length % 4 !== 0) {
        s += "=".repeat(4 - (s.length % 4));
      }
      if (!s) return null;
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
  };
}
