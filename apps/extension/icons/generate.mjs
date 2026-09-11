import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, paint) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y, size);
      const i = y * stride + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function icon(size) {
  return png(size, (x, y, s) => {
    const nx = (x + 0.5) / s;
    const ny = (y + 0.5) / s;
    const inset = 0.12;
    const inPage = nx > inset && nx < 1 - inset && ny > inset && ny < 1 - inset;
    if (!inPage) return [28, 25, 23];
    if (ny < 0.28) return [28, 25, 23];
    const line = ny > 0.4 && ny < 0.86 && (ny * 40) % 6 < 1.6 && nx > 0.28 && nx < 0.78;
    if (line) return [120, 113, 108];
    return [246, 241, 232];
  });
}

mkdirSync(root, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(root, `icon${size}.png`), icon(size));
}
console.log("icons generated");
