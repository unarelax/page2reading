import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CreateTaskResponse } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import {
  findSucceeded,
  getTask,
  insertTask,
  listTasks,
  rowToView,
  updateTask,
} from "../database/db.js";
import { writeCapture } from "../storage/capture.js";
import { nowIso, normalizeUrl } from "../util.js";

const CreateTaskSchema = z.object({
  url: z.string().url(),
  pageTitle: z.string().optional(),
  html: z.string().min(20),
  mode: z.enum(["original", "bilingual"]),
  capturedAt: z.string().optional(),
  force: z.boolean().optional(),
});

export async function buildServer(config: AppConfig) {
  const app = Fastify({ logger: false, bodyLimit: config.htmlMaxBytes });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin.startsWith("chrome-extension://") || /^http:\/\/127\.0\.0\.1/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error("origin not allowed"), false);
    },
  });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== config.authToken) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({
    ok: true,
    chrome: Boolean(config.chromePath),
    deepseek: Boolean(config.deepseekApiKey),
    feishu: Boolean(
      config.feishu.appId && config.feishu.appSecret && config.feishu.appToken && config.feishu.tableId,
    ),
  }));

  app.post("/api/tasks", async (req, reply) => {
    if (Buffer.byteLength(JSON.stringify(req.body ?? ""), "utf8") > config.htmlMaxBytes) {
      return reply.code(413).send({ error: "html too large" });
    }
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    if (Buffer.byteLength(body.html, "utf8") > config.htmlMaxBytes) {
      return reply.code(413).send({ error: "html too large" });
    }
    const normalizedUrl = normalizeUrl(body.url);
    if (!body.force) {
      const dup = findSucceeded(config, normalizedUrl, body.mode);
      if (dup) {
        const res: CreateTaskResponse = {
          taskId: dup.id,
          status: "succeeded",
          duplicate: true,
          message: "相同链接和模式已处理过，如需重跑请 force",
        };
        return res;
      }
    }
    const id = randomUUID();
    const htmlPath = writeCapture(config, id, body.html);
    insertTask(config, {
      id,
      url: body.url,
      normalized_url: normalizedUrl,
      page_title: body.pageTitle ?? null,
      html: "",
      html_path: htmlPath,
      mode: body.mode,
      status: "queued",
      retry_count: 0,
      error: null,
      warnings: null,
      output_dir: null,
      files_json: null,
      created_at: body.capturedAt || nowIso(),
      started_at: null,
      finished_at: null,
    });
    const res: CreateTaskResponse = { taskId: id, status: "queued" };
    return res;
  });

  app.get("/api/tasks", async (req) => {
    const limit = Number((req.query as { limit?: string }).limit || 20);
    return listTasks(config, Math.min(limit, 100)).map(rowToView);
  });

  app.get("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getTask(config, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    return rowToView(row);
  });

  app.post("/api/tasks/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getTask(config, id);
    if (!row) return reply.code(404).send({ error: "not found" });
    updateTask(config, id, {
      status: "queued",
      finished_at: null,
    });
    return { taskId: id, status: "queued" };
  });

  return app;
}
