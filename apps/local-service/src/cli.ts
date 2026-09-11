import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { getDb, insertTask, listTasks, rowToView } from "./database/db.js";
import { logger } from "./logger.js";
import { processTask } from "./pipeline/process.js";
import { buildServer } from "./api/server.js";
import { startWorker } from "./queue/worker.js";
import { writeCapture } from "./storage/capture.js";
import { nowIso, normalizeUrl } from "./util.js";
import { randomUUID } from "node:crypto";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function resolveExisting(path: string): string {
  const candidates = [
    resolve(path),
    resolve(process.cwd(), path),
    resolve(process.cwd(), "../..", path),
  ];
  return candidates.find((p) => existsSync(p)) ?? resolve(path);
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`抓取失败 ${res.status}`);
  return res.text();
}

async function main() {
  const cmd = process.argv[2] || "help";
  const config = loadConfig();
  getDb(config);

  if (cmd === "serve") {
    const app = await buildServer(config);
    startWorker(config);
    await app.listen({ host: "127.0.0.1", port: config.serverPort });
    logger.info(`服务已启动 http://127.0.0.1:${config.serverPort}`);
    logger.info(`鉴权令牌已写入 ${config.configDir}/config.json 的 authToken`);
    return;
  }

  if (cmd === "tasks") {
    for (const row of listTasks(config, 50)) {
      const v = rowToView(row);
      console.log(`${v.status.padEnd(24)} ${v.mode.padEnd(11)} ${v.id}  ${v.pageTitle || v.url}`);
    }
    return;
  }

  if (cmd === "process") {
    const url = arg("--url");
    if (!url) {
      console.error("用法: npm run cli -- process --url <url> [--html file.html] [--mode original|bilingual]");
      process.exit(1);
    }
    const mode = (arg("--mode") as "original" | "bilingual") || "original";
    const sourceHtml = arg("--html");
    const html = sourceHtml ? readFileSync(resolveExisting(sourceHtml), "utf8") : await fetchHtml(url);
    const id = randomUUID();
    const collectedAt = nowIso();
    const captureFile = writeCapture(config, id, html);
    insertTask(config, {
      id,
      url,
      normalized_url: normalizeUrl(url),
      page_title: arg("--title") ?? null,
      html: "",
      html_path: captureFile,
      mode,
      status: "extracting",
      retry_count: 0,
      error: null,
      warnings: null,
      output_dir: null,
      files_json: null,
      created_at: collectedAt,
      started_at: null,
      finished_at: null,
    });
    const meta = await processTask(config, {
      taskId: id,
      url,
      normalizedUrl: normalizeUrl(url),
      html,
      pageTitle: arg("--title"),
      mode,
      collectedAt,
    });
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  if (cmd === "token" || process.argv.includes("--token")) {
    console.log(config.authToken);
    return;
  }

  console.log(`Page2Reading CLI

  npm run serve
  npm run cli -- token
  npm run cli -- tasks
  npm run cli -- process --url https://example.com/post --mode bilingual
  npm run cli -- process --url https://example.com/post --html ./page.html --mode original
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
