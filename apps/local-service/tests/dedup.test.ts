import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";
import { closeDb, getDb, insertTask } from "../src/database/db.js";
import { nowIso } from "../src/util.js";
import { makeTestConfig } from "./helpers.js";

const html = "<html><body><article><p>enough html for the schema min length.</p></article></body></html>";

afterEach(() => {
  closeDb();
});

describe("同 URL 去重", () => {
  it("已 succeeded 的同一规范化 URL + 模式返回 duplicate", async () => {
    const config = makeTestConfig();
    getDb(config);
    insertTask(config, {
      id: "existing-task",
      url: "https://example.com/post?utm_source=x",
      normalized_url: "https://example.com/post",
      page_title: "Post",
      html: "",
      html_path: null,
      mode: "original",
      status: "succeeded",
      retry_count: 0,
      error: null,
      warnings: null,
      output_dir: config.storageRoot,
      files_json: JSON.stringify({
        originalMarkdown: "/tmp/or.md",
        bilingualMarkdown: null,
        pdf: "/tmp/or.pdf",
      }),
      created_at: nowIso(),
      started_at: nowIso(),
      finished_at: nowIso(),
    });

    const app = await buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: "Bearer test-token" },
      payload: {
        url: "https://example.com/post?utm_campaign=dup",
        html,
        mode: "original",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.duplicate).toBe(true);
    expect(body.taskId).toBe("existing-task");
    await app.close();
  });

  it("succeeded_with_warnings 不占去重，方便缺图后重跑", async () => {
    const config = makeTestConfig();
    getDb(config);
    insertTask(config, {
      id: "warn-task",
      url: "https://example.com/missing-img",
      normalized_url: "https://example.com/missing-img",
      page_title: "Post",
      html: "",
      html_path: null,
      mode: "original",
      status: "succeeded_with_warnings",
      retry_count: 0,
      error: null,
      warnings: JSON.stringify(["PDF 图片加载失败 1 张：https://cdn.example/a.gif"]),
      output_dir: config.storageRoot,
      files_json: "{}",
      created_at: nowIso(),
      started_at: nowIso(),
      finished_at: nowIso(),
    });

    const app = await buildServer(config);
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: "Bearer test-token" },
      payload: {
        url: "https://example.com/missing-img",
        html,
        mode: "original",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.duplicate).toBeUndefined();
    expect(body.status).toBe("queued");
    expect(body.taskId).not.toBe("warn-task");
    await app.close();
  });
});
