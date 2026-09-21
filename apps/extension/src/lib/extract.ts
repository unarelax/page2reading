import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { toDateOnly } from "./util.js";

export interface ExtractedArticle {
  title: string;
  author: string | null;
  publishedAt: string | null;
  markdown: string;
  siteName: string | null;
}

function absoluteUrl(base: string, maybe: string | null | undefined): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return maybe;
  }
}

function text(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object" && value && "name" in value) return text((value as { name: unknown }).name);
  return null;
}

function collectJsonLd(document: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || "");
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") out.push(item as Record<string, unknown>);
      }
    } catch {
      // ignore invalid json-ld
    }
  }
  return out;
}

function metaContent(document: Document, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const value = el?.getAttribute("content") || el?.getAttribute("datetime") || el?.textContent;
    if (value?.trim()) return value.trim();
  }
  return null;
}

function absolutizeMedia(document: Document, baseUrl: string): void {
  for (const img of document.querySelectorAll("img")) {
    const src = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original");
    const abs = absoluteUrl(baseUrl, src);
    if (abs) img.setAttribute("src", abs);
    img.removeAttribute("srcset");
  }
  for (const a of document.querySelectorAll("a[href]")) {
    const abs = absoluteUrl(baseUrl, a.getAttribute("href"));
    if (abs) a.setAttribute("href", abs);
  }
}

const CHROME_SELECTORS = [
  "footer",
  "nav",
  "aside",
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  "#comments",
  ".comments",
  "#disqus_thread",
  ".post-responses",
  "#post_responses",
].join(", ");

const ARTICLE_MIN_CHARS = 200;

function visibleTextLength(el: Element): number {
  return (el.textContent || "").replace(/\s+/g, " ").trim().length;
}

function stripChrome(document: Document): void {
  for (const el of document.querySelectorAll(CHROME_SELECTORS)) el.remove();
}

function pickScopedRoot(document: Document): Element | null {
  const specific = document.querySelector(".post-body, [itemprop='articleBody']");
  if (specific && visibleTextLength(specific) >= ARTICLE_MIN_CHARS) return specific;

  const articles = [...document.querySelectorAll("article")].filter(
    (el) => visibleTextLength(el) >= ARTICLE_MIN_CHARS,
  );
  if (articles.length === 0) return null;
  articles.sort((a, b) => visibleTextLength(b) - visibleTextLength(a));
  return articles[0];
}

function parseReadable(document: Document) {
  return new Readability(document, { charThreshold: 80 }).parse();
}

function extractReadable(document: Document) {
  const root = pickScopedRoot(document);
  if (root) {
    const scoped = document.implementation.createHTMLDocument(document.title);
    scoped.body.appendChild(root.cloneNode(true));
    const parsed = parseReadable(scoped);
    if (parsed?.content) return parsed;
  }
  return parseReadable(document);
}

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);
  td.addRule("keepPreCode", {
    filter: ["pre"],
    replacement(_content, node) {
      const el = node as HTMLElement;
      const code = el.querySelector("code");
      const lang = (code?.className || "").match(/language-([\w-]+)/)?.[1] ?? "";
      const textContent = (code?.textContent || el.textContent || "").replace(/\n$/, "");
      return `\n\n\`\`\`${lang}\n${textContent}\n\`\`\`\n\n`;
    },
  });
  return td;
}

export function extractArticle(html: string, pageUrl: string, fallbackTitle?: string): ExtractedArticle {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const el of document.querySelectorAll("script, style, noscript, iframe")) el.remove();
  stripChrome(document);
  absolutizeMedia(document, pageUrl);

  const jsonLd = collectJsonLd(document);
  const articleLd =
    jsonLd.find((item) => {
      const t = item["@type"];
      const types = Array.isArray(t) ? t : [t];
      return types.some((x) => String(x).toLowerCase().includes("article"));
    }) ?? jsonLd[0];

  const parsed = extractReadable(document);
  if (!parsed?.content) {
    throw new Error("无法提取正文，请确认当前页是一篇完整文章");
  }

  const title =
    parsed.title?.trim() ||
    text(articleLd?.headline) ||
    metaContent(document, ['meta[property="og:title"]', "title"]) ||
    fallbackTitle ||
    "Untitled";

  const author =
    parsed.byline?.replace(/^by\s+/i, "").trim() ||
    text(articleLd?.author) ||
    metaContent(document, ['meta[name="author"]', 'meta[property="article:author"]']) ||
    null;

  const publishedAt = toDateOnly(
    text(articleLd?.datePublished) ||
      metaContent(document, [
        'meta[property="article:published_time"]',
        'meta[name="date"]',
        'meta[name="pubdate"]',
        "time[datetime]",
      ]),
  );

  const markdown = createTurndown().turndown(parsed.content).trim();
  if (!markdown) throw new Error("正文转 Markdown 后为空");

  return {
    title,
    author,
    publishedAt,
    markdown,
    siteName: parsed.siteName || text(articleLd?.publisher) || null,
  };
}
