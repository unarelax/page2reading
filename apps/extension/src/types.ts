export type ExportMode = "original" | "bilingual";

export type TaskStatus =
  | "queued"
  | "extracting"
  | "translating"
  | "rendering"
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed";

/** 产物文件名（相对用户所选根目录，如 `20260919/or-slug.md`）。 */
export interface ArticleFiles {
  originalMarkdown: string;
  bilingualMarkdown: string | null;
  pdf: string;
}

export interface TaskRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  pageTitle: string | null;
  mode: ExportMode;
  status: TaskStatus;
  error: string | null;
  warnings: string[];
  files: ArticleFiles | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExtensionSettings {
  apiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiKey: "",
  model: "deepseek-flash",
};

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// ---- 消息协议（popup / SW / offscreen / render 页之间） ----

export interface SubmitMessage {
  type: "submit";
  url: string;
  pageTitle: string;
  html: string;
  mode: ExportMode;
}

export interface RunMessage {
  type: "run";
  taskId: string;
  url: string;
  normalizedUrl: string;
  pageTitle: string | null;
  html: string;
  mode: ExportMode;
  collectedAt: string;
  settings: ExtensionSettings;
}

export interface RequestPdfMessage {
  type: "request-pdf";
  taskId: string;
  html: string;
  mode: ExportMode;
  fileName: string;
}

export interface PdfResultMessage {
  type: "pdf-result";
  taskId: string;
  base64: string;
  failedImages: string[];
}

export interface PdfErrorMessage {
  type: "pdf-error";
  taskId: string;
  error: string;
}

export interface DoneMessage {
  type: "done";
  taskId: string;
  status: "succeeded" | "succeeded_with_warnings";
  warnings: string[];
  files: ArticleFiles;
}

export interface FailedMessage {
  type: "failed";
  taskId: string;
  error: string;
}

export interface RenderReadyMessage {
  type: "render-ready";
  taskId: string;
  failedImages: string[];
}

export interface GetTaskListMessage {
  type: "get-task-list";
}
