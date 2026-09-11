import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { extractArticle, translateBilingual, buildPdf, upsertFeishuRecord, feishuConfigured } = vi.hoisted(() => ({
  extractArticle: vi.fn(),
  translateBilingual: vi.fn(),
  buildPdf: vi.fn(),
  upsertFeishuRecord: vi.fn(),
  feishuConfigured: vi.fn(),
}));

vi.mock("../src/extractor/extract.js", () => ({ extractArticle }));
vi.mock("../src/translator/translate.js", () => ({ translateBilingual }));
vi.mock("../src/pdf/buildPdf.js", () => ({ buildPdf }));
vi.mock("../src/feishu/client.js", () => ({ upsertFeishuRecord, feishuConfigured }));

import { closeDb, getDb, getTask, insertTask } from "../src/database/db.js";
import { processTask } from "../src/pipeline/process.js";
import { nowIso } from "../src/util.js";
import { makeTestConfig } from "./helpers.js";

afterEach(() => {
  closeDb();
  vi.clearAllMocks();
});

function seedFailedFeishuTask(config: ReturnType<typeof makeTestConfig>, files: { md: string; pdf: string }) {
  mkdirSync(dirname(files.md), { recursive: true });
  writeFileSync(
    files.md,
    `---
title: "Retried"
author: "A"
published: "2026-09-01"
source: "https://example.com/feishu"
collected: "2026-09-11T00:00:00.000Z"
---

body
`,
  );
  writeFileSync(files.pdf, "%PDF-1.4 dummy");
  getDb(config);
  insertTask(config, {
    id: "feishu-fail",
    url: "https://example.com/feishu",
    normalized_url: "https://example.com/feishu",
    page_title: "Retried",
    html: "",
    html_path: null,
    mode: "original",
    status: "failed",
    retry_count: 1,
    error: "飞书写入失败: FieldNameNotFound",
    warnings: "[]",
    output_dir: dirname(files.pdf),
    files_json: JSON.stringify({
      originalMarkdown: files.md,
      bilingualMarkdown: null,
      pdf: files.pdf,
    }),
    created_at: nowIso(),
    started_at: nowIso(),
    finished_at: nowIso(),
  });
}

describe("流水线断点与缺图状态", () => {
  it("飞书列名错误重试只补同步，不再抽取或渲染", async () => {
    const config = makeTestConfig();
    const files = {
      md: join(config.storageRoot, "or-retried.md"),
      pdf: join(config.storageRoot, "or-retried.pdf"),
    };
    seedFailedFeishuTask(config, files);
    feishuConfigured.mockReturnValue(true);
    upsertFeishuRecord.mockResolvedValue(undefined);

    await processTask(config, {
      taskId: "feishu-fail",
      url: "https://example.com/feishu",
      normalizedUrl: "https://example.com/feishu",
      mode: "original",
      collectedAt: nowIso(),
    });

    expect(extractArticle).not.toHaveBeenCalled();
    expect(translateBilingual).not.toHaveBeenCalled();
    expect(buildPdf).not.toHaveBeenCalled();
    expect(upsertFeishuRecord).toHaveBeenCalledTimes(1);
    expect(getTask(config, "feishu-fail")?.status).toBe("succeeded");
  });

  it("PDF 缺图记为 succeeded_with_warnings 而不是 succeeded", async () => {
    const config = makeTestConfig();
    getDb(config);
    insertTask(config, {
      id: "img-task",
      url: "https://example.com/img",
      normalized_url: "https://example.com/img",
      page_title: "Img",
      html: "<html><body><article><p>hello world this is long enough.</p></article></body></html>",
      html_path: null,
      mode: "original",
      status: "queued",
      retry_count: 0,
      error: null,
      warnings: null,
      output_dir: null,
      files_json: null,
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
    });
    extractArticle.mockReturnValue({
      title: "Img",
      author: null,
      publishedAt: null,
      markdown: "hello",
      siteName: null,
    });
    buildPdf.mockResolvedValue({ failedImages: ["https://cdn.example/a.gif"] });
    feishuConfigured.mockReturnValue(false);

    await processTask(config, {
      taskId: "img-task",
      url: "https://example.com/img",
      normalizedUrl: "https://example.com/img",
      html: "<html><body><article><p>hello world this is long enough.</p></article></body></html>",
      pageTitle: "Img",
      mode: "original",
      collectedAt: nowIso(),
    });

    const row = getTask(config, "img-task");
    expect(row?.status).toBe("succeeded_with_warnings");
    expect(row?.warnings).toMatch(/PDF 图片加载失败/);
  });
});
