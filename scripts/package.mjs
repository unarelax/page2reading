// 把 apps/extension/dist 打成可分发的 zip（GitHub Releases 用）。
// 用法：npm run build && node scripts/package.mjs
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "apps", "extension", "dist");
const manifest = JSON.parse(readFileSync(join(distDir, "manifest.json"), "utf8"));
const version = manifest.version;

const releasesDir = join(root, "releases");
mkdirSync(releasesDir, { recursive: true });
// 固定文件名，README 里的 latest/download 链接不用随版本改。
const outPath = join(releasesDir, "Page2Reading.zip");

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });
archive.on("error", (err) => {
  throw err;
});
archive.pipe(output);

// false 表示把 dist 的内容平铺到 zip 根（manifest.json 必须在根，Load unpacked 才能识别）。
archive.directory(distDir, false);
await archive.finalize();

console.log(`已打包: ${outPath}（扩展版本 ${version}）`);
