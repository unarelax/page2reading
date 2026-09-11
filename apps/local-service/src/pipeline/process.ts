import { existsSync, readFileSync } from "node:fs";
import type { ArticleMetadata, ExportMode, TaskStatus } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import { extractArticle } from "../extractor/extract.js";
import { feishuConfigured, upsertFeishuRecord } from "../feishu/client.js";
import { logger } from "../logger.js";
import { buildPdf } from "../pdf/buildPdf.js";
import { clearTaskCapture, getTask, updateTask } from "../database/db.js";
import { readCapture } from "../storage/capture.js";
import {
  allocateArticleFiles,
  buildFrontmatter,
  filesFromSaved,
  parseFrontmatter,
  writeTextAtomic,
  type ArticleFiles,
} from "../storage/paths.js";
import { translateBilingual } from "../translator/translate.js";
import { nowIso } from "../util.js";

export function terminalStatus(warnings: string[]): TaskStatus {
  if (warnings.some((w) => w.includes("PDF 图片加载失败"))) {
    return "succeeded_with_warnings";
  }
  return "succeeded";
}

export interface ProcessInput {
  taskId: string;
  url: string;
  normalizedUrl: string;
  html?: string;
  pageTitle?: string | null;
  mode: ExportMode;
  collectedAt: string;
}

function metaFromMarkdown(mdPath: string, extra: {
  normalizedUrl: string;
  mode: ExportMode;
  files: ArticleMetadata["files"];
  warnings: string[];
}): ArticleMetadata {
  const parsed = parseFrontmatter(readFileSync(mdPath, "utf8"));
  return {
    schemaVersion: 1,
    title: parsed.title,
    author: parsed.author || null,
    publishedAt: parsed.published || null,
    sourceUrl: parsed.sourceUrl,
    normalizedUrl: extra.normalizedUrl,
    collectedAt: parsed.collected || nowIso(),
    mode: extra.mode,
    files: extra.files,
    warnings: extra.warnings,
  };
}

export async function processTask(config: AppConfig, input: ProcessInput): Promise<ArticleMetadata> {
  const existing = getTask(config, input.taskId);
  const warnings: string[] = existing?.warnings ? JSON.parse(existing.warnings) : [];

  if (existing?.files_json) {
    const files = JSON.parse(existing.files_json) as ArticleMetadata["files"];
    const syncOnly = Boolean(existing.error && existing.error.includes("飞书"));
    const mdPath = input.mode === "bilingual" ? files.bilingualMarkdown : files.originalMarkdown;
    if (syncOnly && files.pdf && existsSync(files.pdf) && mdPath && existsSync(mdPath)) {
      const meta = metaFromMarkdown(mdPath, {
        normalizedUrl: input.normalizedUrl,
        mode: input.mode,
        files,
        warnings,
      });
      clearTaskCapture(config, input.taskId);
      await syncFeishu(config, input.taskId, meta, warnings);
      return meta;
    }
  }

  updateTask(config, input.taskId, { status: "extracting", started_at: nowIso(), error: null });

  const savedFiles = existing?.files_json
    ? (JSON.parse(existing.files_json) as ArticleMetadata["files"])
    : null;
  const reusableOriginal =
    savedFiles?.originalMarkdown && existsSync(savedFiles.originalMarkdown)
      ? savedFiles.originalMarkdown
      : null;

  let paths: ArticleFiles;
  let original: string;
  let title: string;
  let author: string | null;
  let publishedAt: string | null;

  if (reusableOriginal) {
    original = readFileSync(reusableOriginal, "utf8");
    const parsed = parseFrontmatter(original);
    title = parsed.title || input.pageTitle || "Untitled";
    author = parsed.author || null;
    publishedAt = parsed.published || null;
    paths =
      existing?.output_dir && savedFiles
        ? filesFromSaved(savedFiles, input.mode)
        : allocateArticleFiles(config, title, input.collectedAt);
  } else {
    const html = input.html?.trim() ? input.html : existing ? readCapture(config, existing) : "";
    if (html.length < 20) {
      throw new Error("缺少页面快照，请从扩展重新提交这篇文章");
    }
    const extracted = extractArticle(html, input.url, input.pageTitle ?? undefined);
    title = extracted.title;
    author = extracted.author;
    publishedAt = extracted.publishedAt;
    paths =
      existing?.output_dir && savedFiles
        ? filesFromSaved(savedFiles, input.mode)
        : allocateArticleFiles(config, extracted.title, input.collectedAt);
    original = `${buildFrontmatter({
      title: extracted.title,
      author: extracted.author,
      published: extracted.publishedAt,
      source: input.url,
      collected: input.collectedAt,
    })}${extracted.markdown}\n`;
    writeTextAtomic(paths.originalMarkdown, original);
    updateTask(config, input.taskId, {
      output_dir: paths.dir,
      page_title: title,
      files_json: JSON.stringify({
        originalMarkdown: paths.originalMarkdown,
        bilingualMarkdown: null,
        pdf: paths.originalPdf,
      }),
    });
  }

  clearTaskCapture(config, input.taskId);

  let bilingualPath: string | null = null;
  let pdfSource = original;
  let pdfMode: ExportMode = "original";
  let pdfPath = paths.originalPdf;

  if (input.mode === "bilingual") {
    updateTask(config, input.taskId, { status: "translating", output_dir: paths.dir });
    const bilingual = await translateBilingual(original, config);
    writeTextAtomic(paths.bilingualMarkdown, bilingual);
    bilingualPath = paths.bilingualMarkdown;
    pdfSource = bilingual;
    pdfMode = "bilingual";
    pdfPath = paths.bilingualPdf;
  }

  updateTask(config, input.taskId, { status: "rendering", output_dir: paths.dir });
  const pdf = await buildPdf({
    markdown: pdfSource,
    outputPdf: pdfPath,
    mode: pdfMode,
    config,
  });
  if (pdf.failedImages.length) {
    warnings.push(`PDF 图片加载失败 ${pdf.failedImages.length} 张：${pdf.failedImages.slice(0, 5).join(" ")}`);
  }

  const meta: ArticleMetadata = {
    schemaVersion: 1,
    title: title,
    author: author,
    publishedAt: publishedAt,
    sourceUrl: input.url,
    normalizedUrl: input.normalizedUrl,
    collectedAt: input.collectedAt,
    mode: input.mode,
    files: {
      originalMarkdown: paths.originalMarkdown,
      bilingualMarkdown: bilingualPath,
      pdf: pdfPath,
    },
    warnings,
  };
  updateTask(config, input.taskId, {
    output_dir: paths.dir,
    files_json: JSON.stringify(meta.files),
    warnings: JSON.stringify(warnings),
    page_title: title,
  });

  await syncFeishu(config, input.taskId, meta, warnings);
  return meta;
}

async function syncFeishu(
  config: AppConfig,
  taskId: string,
  meta: ArticleMetadata,
  warnings: string[],
): Promise<void> {
  if (!feishuConfigured(config)) {
    warnings.push("未配置飞书，已跳过台账同步");
    updateTask(config, taskId, {
      status: terminalStatus(warnings),
      finished_at: nowIso(),
      warnings: JSON.stringify(warnings),
    });
    logger.warn("飞书未配置，跳过同步");
    return;
  }
  updateTask(config, taskId, { status: "syncing" });
  await upsertFeishuRecord(config, meta);
  updateTask(config, taskId, {
    status: terminalStatus(warnings),
    finished_at: nowIso(),
    error: null,
    warnings: JSON.stringify(warnings),
  });
}
