import { loadConfig } from "./config.js";
import { getDb } from "./database/db.js";
import { logger } from "./logger.js";
import { buildServer } from "./api/server.js";
import { startWorker } from "./queue/worker.js";
import { purgeExpiredCaptures } from "./storage/capture.js";

async function main() {
  const config = loadConfig();
  getDb(config);
  const purged = purgeExpiredCaptures(config);
  if (purged) logger.info({ purged }, "已删除过期 inbox HTML 快照");
  startWorker(config);
  const app = await buildServer(config);
  await app.listen({ host: "127.0.0.1", port: config.serverPort });
  logger.info(
    {
      port: config.serverPort,
      storageRoot: config.storageRoot,
      chrome: config.chromePath,
      deepseek: Boolean(config.deepseekApiKey),
      feishu: Boolean(config.feishu.appId && config.feishu.tableId),
      tokenFile: `${config.configDir}/config.json`,
    },
    "Page2Reading 本地服务已启动",
  );
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
