export type ExportMode = "original" | "bilingual";

export type TaskStatus =
  | "queued"
  | "extracting"
  | "translating"
  | "rendering"
  | "syncing"
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed";

export interface ArticleMetadata {
  schemaVersion: 1;
  title: string;
  author: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  normalizedUrl: string;
  collectedAt: string;
  mode: ExportMode;
  files: {
    originalMarkdown: string;
    bilingualMarkdown: string | null;
    pdf: string;
  };
  warnings: string[];
}

export interface CreateTaskRequest {
  url: string;
  pageTitle?: string;
  html: string;
  mode: ExportMode;
  capturedAt?: string;
  force?: boolean;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
  duplicate?: boolean;
  message?: string;
}

export interface TaskView {
  id: string;
  url: string;
  normalizedUrl: string;
  pageTitle: string | null;
  mode: ExportMode;
  status: TaskStatus;
  retryCount: number;
  error: string | null;
  warnings: string[];
  outputDir: string | null;
  files: ArticleMetadata["files"] | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
