import Database from "better-sqlite3";
import type { ExportMode, TaskStatus, TaskView } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import { unlinkCaptureFile, writeCapture } from "../storage/capture.js";
import { nowIso } from "../util.js";

export interface TaskRow {
  id: string;
  url: string;
  normalized_url: string;
  page_title: string | null;
  html: string;
  html_path: string | null;
  mode: ExportMode;
  status: TaskStatus;
  retry_count: number;
  error: string | null;
  warnings: string | null;
  output_dir: string | null;
  files_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const TASK_VIEW_COLUMNS = `id, url, normalized_url, page_title, html_path, mode, status, retry_count,
      error, warnings, output_dir, files_json, created_at, started_at, finished_at`;

let db: Database.Database | null = null;

function columnNames(database: Database.Database): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function migrateAndPurge(database: Database.Database, config: AppConfig): void {
  const cols = columnNames(database);
  if (!cols.has("html_path")) {
    database.exec(`ALTER TABLE tasks ADD COLUMN html_path TEXT`);
  }

  const fat = database
    .prepare(`SELECT id, html, status, files_json FROM tasks WHERE length(html) > 20`)
    .all() as { id: string; html: string; status: string; files_json: string | null }[];
  if (!fat.length) return;

  let spilled = 0;
  let dropped = 0;
  const keepStatus = new Set(["queued", "extracting", "translating", "rendering"]);
  for (const row of fat) {
    const needsPage =
      keepStatus.has(row.status) || (row.status === "failed" && !row.files_json);
    if (needsPage) {
      const path = writeCapture(config, row.id, row.html);
      database.prepare(`UPDATE tasks SET html = '', html_path = ? WHERE id = ?`).run(path, row.id);
      spilled += 1;
    } else {
      unlinkCaptureFile(config, row.id, null);
      database.prepare(`UPDATE tasks SET html = '', html_path = NULL WHERE id = ?`).run(row.id);
      dropped += 1;
    }
  }
  try {
    database.exec("VACUUM");
  } catch (err) {
    logger.warn({ err }, "无法立刻收缩数据库文件，下次启动再试");
  }
  logger.info({ spilled, dropped }, "已把任务表里的整页 HTML 迁出或清除");
}

export function getDb(config: AppConfig): Database.Database {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      page_title TEXT,
      html TEXT NOT NULL DEFAULT '',
      html_path TEXT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      warnings TEXT,
      output_dir TEXT,
      files_json TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_url_mode ON tasks(normalized_url, mode);
  `);
  migrateAndPurge(db, config);
  return db;
}

export function closeDb(): void {
  if (!db) return;
  db.close();
  db = null;
}

function normalizeRow(row: TaskRow): TaskRow {
  return { ...row, html: row.html ?? "", html_path: row.html_path ?? null };
}

export function rowToView(row: TaskRow): TaskView {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    pageTitle: row.page_title,
    mode: row.mode,
    status: row.status,
    retryCount: row.retry_count,
    error: row.error,
    warnings: row.warnings ? (JSON.parse(row.warnings) as string[]) : [],
    outputDir: row.output_dir,
    files: row.files_json ? JSON.parse(row.files_json) : null,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function insertTask(config: AppConfig, row: TaskRow): void {
  getDb(config)
    .prepare(
      `INSERT INTO tasks (
        id, url, normalized_url, page_title, html, html_path, mode, status, retry_count,
        error, warnings, output_dir, files_json, created_at, started_at, finished_at
      ) VALUES (
        @id, @url, @normalized_url, @page_title, @html, @html_path, @mode, @status, @retry_count,
        @error, @warnings, @output_dir, @files_json, @created_at, @started_at, @finished_at
      )`,
    )
    .run({ ...row, html: row.html || "", html_path: row.html_path ?? null });
}

export function findSucceeded(config: AppConfig, normalizedUrl: string, mode: ExportMode): TaskRow | undefined {
  const row = getDb(config)
    .prepare(
      `SELECT ${TASK_VIEW_COLUMNS} FROM tasks WHERE normalized_url = ? AND mode = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`,
    )
    .get(normalizedUrl, mode) as TaskRow | undefined;
  return row ? normalizeRow({ ...row, html: "" }) : undefined;
}

export function getTask(config: AppConfig, id: string): TaskRow | undefined {
  const row = getDb(config)
    .prepare(`SELECT ${TASK_VIEW_COLUMNS} FROM tasks WHERE id = ?`)
    .get(id) as TaskRow | undefined;
  return row ? normalizeRow({ ...row, html: "" }) : undefined;
}

export function listTasks(config: AppConfig, limit = 20): TaskRow[] {
  return (
    getDb(config)
      .prepare(`SELECT ${TASK_VIEW_COLUMNS} FROM tasks ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as TaskRow[]
  ).map((row) => normalizeRow({ ...row, html: "" }));
}

export function claimNext(config: AppConfig): TaskRow | undefined {
  const database = getDb(config);
  return database.transaction(() => {
    const row = database
      .prepare(`SELECT ${TASK_VIEW_COLUMNS} FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
      .get() as TaskRow | undefined;
    if (!row) return undefined;
    database
      .prepare(`UPDATE tasks SET status = 'extracting', started_at = ? WHERE id = ? AND status = 'queued'`)
      .run(nowIso(), row.id);
    return normalizeRow({ ...(database.prepare(`SELECT ${TASK_VIEW_COLUMNS} FROM tasks WHERE id = ?`).get(row.id) as TaskRow), html: "" });
  })();
}

export function listRecoverable(config: AppConfig): TaskRow[] {
  return (
    getDb(config)
      .prepare(
        `SELECT ${TASK_VIEW_COLUMNS} FROM tasks WHERE status IN ('extracting','translating','rendering','syncing')`,
      )
      .all() as TaskRow[]
  ).map((row) => normalizeRow({ ...row, html: "" }));
}

export function updateTask(
  config: AppConfig,
  id: string,
  patch: Partial<Omit<TaskRow, "id">>,
): void {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const assignments = keys.map((k) => `${k} = @${k}`).join(", ");
  getDb(config)
    .prepare(`UPDATE tasks SET ${assignments} WHERE id = @id`)
    .run({ ...patch, id });
}

export function clearTaskCapture(config: AppConfig, id: string): void {
  const row = getTask(config, id);
  unlinkCaptureFile(config, id, row?.html_path);
  updateTask(config, id, { html: "", html_path: null });
}
