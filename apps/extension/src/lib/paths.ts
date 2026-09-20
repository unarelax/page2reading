import { collectedDayStamp, slugifyTitle } from "./util.js";
import type { ExportMode } from "../types.js";

export interface ArticleFiles {
  dir: string;
  slug: string;
  originalMarkdown: string;
  originalPdf: string;
  bilingualMarkdown: string;
  bilingualPdf: string;
}

/** 分配某篇文章在根目录下的相对路径（文件名含 YYYYMMDD 子目录与 or-/tr- 前缀）。 */
export function allocateArticleFiles(title: string, collectedAt: string): ArticleFiles {
  const dir = collectedDayStamp(collectedAt);
  const slug = slugifyTitle(title);
  return {
    dir,
    slug,
    originalMarkdown: `${dir}/or-${slug}.md`,
    originalPdf: `${dir}/or-${slug}.pdf`,
    bilingualMarkdown: `${dir}/tr-${slug}.md`,
    bilingualPdf: `${dir}/tr-${slug}.pdf`,
  };
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

export function pickMarkdown(files: ArticleFiles, mode: ExportMode): string {
  return mode === "bilingual" ? files.bilingualMarkdown : files.originalMarkdown;
}
