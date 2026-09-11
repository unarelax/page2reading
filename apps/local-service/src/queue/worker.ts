import type { AppConfig } from "../config.js";
import { getTask, listRecoverable, claimNext, updateTask } from "../database/db.js";
import { logger } from "../logger.js";
import { processTask } from "../pipeline/process.js";
import { purgeExpiredCaptures, readCapture } from "../storage/capture.js";
import { nowIso } from "../util.js";

let running = 0;

export function recoverInFlight(config: AppConfig): void {
  for (const row of listRecoverable(config)) {
    logger.warn({ id: row.id, status: row.status }, "服务重启，任务重新入队");
    updateTask(config, row.id, {
      status: "queued",
      error: row.status === "syncing" ? "飞书同步中断" : "interrupted",
    });
  }
}

export function startWorker(config: AppConfig): void {
  recoverInFlight(config);
  purgeExpiredCaptures(config);
  const tick = async () => {
    if (running >= config.maxConcurrentTasks) return;
    const next = claimNext(config);
    if (!next) return;
    running += 1;
    logger.info({ id: next.id, mode: next.mode, url: next.url }, "开始处理任务");
    try {
      await processTask(config, {
        taskId: next.id,
        url: next.url,
        normalizedUrl: next.normalized_url,
        html: readCapture(config, next),
        pageTitle: next.page_title,
        mode: next.mode,
        collectedAt: next.created_at,
      });
      const done = getTask(config, next.id);
      if (done?.status === "succeeded_with_warnings") {
        logger.warn({ id: next.id, warnings: done.warnings }, "任务完成但 PDF 缺图");
      } else {
        logger.info({ id: next.id }, "任务完成");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ id: next.id, err }, "任务失败");
      const current = getTask(config, next.id);
      updateTask(config, next.id, {
        status: "failed",
        error: message,
        retry_count: (current?.retry_count ?? 0) + 1,
        finished_at: nowIso(),
      });
    } finally {
      running -= 1;
    }
  };
  setInterval(() => {
    tick().catch((err) => logger.error({ err }, "worker tick 失败"));
  }, 800);
  setInterval(() => {
    const purged = purgeExpiredCaptures(config);
    if (purged) logger.info({ purged }, "已删除过期 inbox HTML 快照");
  }, 6 * 60 * 60 * 1000);
}
