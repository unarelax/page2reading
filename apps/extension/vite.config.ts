import { defineConfig, type Plugin } from "vite";
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const projectDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = fileURLToPath(new URL("./dist", import.meta.url));

// 把 manifest.json 与图标拷进 dist（Load unpacked 要求 dist 含 manifest.json）。
function copyStaticFiles(): Plugin {
  return {
    name: "p2r:copy-static",
    apply: "build",
    closeBundle() {
      cpSync(fileURLToPath(new URL("./manifest.json", import.meta.url)), `${distDir}/manifest.json`);
      mkdirSync(`${distDir}/icons`, { recursive: true });
      for (const size of [16, 48, 128]) {
        cpSync(`${projectDir}/icons/icon${size}.png`, `${distDir}/icons/icon${size}.png`);
      }
    },
  };
}

// root 指向 src，让构建出的 HTML 落在 dist 根目录（与 manifest 的引用一致）。
export default defineConfig({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  build: {
    outDir: distDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./src/popup.html", import.meta.url)),
        settings: fileURLToPath(new URL("./src/settings.html", import.meta.url)),
        offscreen: fileURLToPath(new URL("./src/offscreen.html", import.meta.url)),
        render: fileURLToPath(new URL("./src/render.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  plugins: [copyStaticFiles()],
});
