import type { ArticleMetadata } from "@page2reading/shared";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";

interface TenantToken {
  token: string;
  expireAt: number;
}

let cached: TenantToken | null = null;

export function feishuConfigured(config: AppConfig): boolean {
  const { appId, appSecret, appToken, tableId } = config.feishu;
  return Boolean(appId && appSecret && appToken && tableId);
}

async function tenantToken(config: AppConfig): Promise<string> {
  if (cached && cached.expireAt > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: config.feishu.appId,
      app_secret: config.feishu.appSecret,
    }),
  });
  const json = (await res.json()) as { code: number; tenant_access_token?: string; expire?: number; msg?: string };
  if (json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`飞书鉴权失败: ${json.msg || json.code}`);
  }
  cached = {
    token: json.tenant_access_token,
    expireAt: Date.now() + (json.expire ?? 7200) * 1000,
  };
  return cached.token;
}

function fieldsFrom(meta: ArticleMetadata): Record<string, string> {
  const markdown =
    meta.mode === "bilingual" ? meta.files.bilingualMarkdown : meta.files.originalMarkdown;
  return {
    标题: meta.title,
    原文链接: meta.sourceUrl,
    作者: meta.author ?? "",
    文章发布日期: meta.publishedAt ?? "",
    收录时间: meta.collectedAt,
    "PDF 文件": meta.files.pdf,
    "Markdown 文件": markdown ?? "",
  };
}

async function searchByUrl(
  config: AppConfig,
  token: string,
  url: string,
): Promise<string | null> {
  const endpoint = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records/search`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        conjunction: "and",
        conditions: [{ field_name: "原文链接", operator: "is", value: [url] }],
      },
    }),
  });
  const json = (await res.json()) as { code: number; data?: { items?: { record_id: string }[] }; msg?: string };
  if (json.code !== 0) {
    logger.warn({ msg: json.msg }, "飞书搜索记录失败，将新建");
    return null;
  }
  return json.data?.items?.[0]?.record_id ?? null;
}

export async function upsertFeishuRecord(config: AppConfig, meta: ArticleMetadata): Promise<void> {
  if (!feishuConfigured(config)) {
    throw new Error("未配置飞书凭证");
  }
  const token = await tenantToken(config);
  const fields = fieldsFrom(meta);
  const existing = await searchByUrl(config, token, meta.sourceUrl);
  const base = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records`;
  const url = existing ? `${base}/${existing}` : base;
  const res = await fetch(url, {
    method: existing ? "PUT" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0) {
    throw new Error(`飞书写入失败: ${json.msg || json.code}`);
  }
}
