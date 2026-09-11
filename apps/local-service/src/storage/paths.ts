import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ArticleMetadata, ExportMode } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import { collectedDayStamp, slugifyTitle } from "../util.js";

export interface ArticleFiles {
  dir: string;
  slug: string;
  originalMarkdown: string;
  originalPdf: string;
  bilingualMarkdown: string;
  bilingualPdf: string;
}

export function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + "/")) {
    throw new Error(`拒绝写入根目录之外: ${target}`);
  }
  return resolvedTarget;
}

export function allocateArticleFiles(
  config: AppConfig,
  title: string,
  collectedAt: string,
): ArticleFiles {
  const dir = join(config.storageRoot, collectedDayStamp(collectedAt));
  mkdirSync(dir, { recursive: true });
  assertInsideRoot(config.storageRoot, dir);
  const slug = slugifyTitle(title);
  return filesForSlug(dir, slug);
}

export function filesForSlug(dir: string, slug: string): ArticleFiles {
  return {
    dir,
    slug,
    originalMarkdown: join(dir, `or-${slug}.md`),
    originalPdf: join(dir, `or-${slug}.pdf`),
    bilingualMarkdown: join(dir, `tr-${slug}.md`),
    bilingualPdf: join(dir, `tr-${slug}.pdf`),
  };
}

export function filesFromSaved(
  saved: ArticleMetadata["files"],
  mode: ExportMode,
): ArticleFiles {
  const pdf = saved.pdf;
  const dir = dirname(pdf);
  const base = pdf.replace(/\.(pdf)$/i, "").split("/").pop() || "untitled";
  const slug = base.replace(/^(or|tr)-/, "");
  const rebuilt = filesForSlug(dir, slug);
  return {
    ...rebuilt,
    originalMarkdown: saved.originalMarkdown || rebuilt.originalMarkdown,
    bilingualMarkdown: saved.bilingualMarkdown || rebuilt.bilingualMarkdown,
    originalPdf: mode === "original" ? pdf : rebuilt.originalPdf,
    bilingualPdf: mode === "bilingual" ? pdf : rebuilt.bilingualPdf,
  };
}

export function writeTextAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function buildFrontmatter(meta: {
  title: string;
  author: string | null;
  published: string | null;
  source: string;
  collected: string;
}): string {
  const lines = ["---", `title: ${JSON.stringify(meta.title)}`];
  if (meta.author) lines.push(`author: ${JSON.stringify(meta.author)}`);
  if (meta.published) lines.push(`published: ${JSON.stringify(meta.published)}`);
  lines.push(`source: ${JSON.stringify(meta.source)}`);
  lines.push(`collected: ${JSON.stringify(meta.collected)}`);
  lines.push("---", "");
  return lines.join("\n");
}

export function parseFrontmatter(src: string): {
  body: string;
  title: string;
  sourceUrl: string;
  author: string;
  published: string;
  collected: string;
} {
  let body = src;
  let title = "";
  let sourceUrl = "";
  let author = "";
  let published = "";
  let collected = "";
  if (src.startsWith("---")) {
    const end = src.indexOf("\n---", 3);
    if (end !== -1) {
      const fm = src.slice(3, end);
      title = fm.match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1]?.trim() ?? "";
      sourceUrl = fm.match(/^source:\s*["']?(.*?)["']?\s*$/m)?.[1]?.trim() ?? "";
      author = fm.match(/^author:\s*["']?(.*?)["']?\s*$/m)?.[1]?.trim() ?? "";
      published = fm.match(/^published:\s*["']?(.*?)["']?\s*$/m)?.[1]?.trim() ?? "";
      collected = fm.match(/^collected:\s*["']?(.*?)["']?\s*$/m)?.[1]?.trim() ?? "";
      body = src.slice(end + 4).replace(/^\s+/, "");
    }
  }
  return { body, title, sourceUrl, author, published, collected };
}
