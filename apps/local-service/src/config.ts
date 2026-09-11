import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  storageRoot: string;
  configDir: string;
  dbPath: string;
  serverPort: number;
  authToken: string;
  chromePath: string | null;
  maxConcurrentTasks: number;
  imageLoadTimeoutMs: number;
  htmlMaxBytes: number;
  deepseekApiKey: string | null;
  deepseekBaseUrl: string;
  deepseekModel: string;
  feishu: {
    appId: string | null;
    appSecret: string | null;
    appToken: string | null;
    tableId: string | null;
  };
}

interface PersistedConfig {
  storageRoot?: string;
  serverPort?: number;
  authToken?: string;
  chromePath?: string;
  maxConcurrentTasks?: number;
  imageLoadTimeoutMs?: number;
}

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function configDir(): string {
  return join(homedir(), ".page2reading");
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function detectChromePath(explicit?: string | null): string | null {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    DEFAULT_CHROME,
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function loadConfig(): AppConfig {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  loadDotenv({ path: join(process.cwd(), ".env") });
  loadDotenv({ path: join(process.cwd(), "../../.env") });
  loadDotenv({ path: join(dir, ".env"), override: false });

  const persistedPath = join(dir, "config.json");
  let persisted = readJson<PersistedConfig>(persistedPath) ?? {};
  if (!persisted.authToken) {
    persisted = { ...persisted, authToken: randomBytes(24).toString("hex") };
    writeFileSync(persistedPath, JSON.stringify(persisted, null, 2) + "\n");
  }

  const storageRoot =
    process.env.PAGE2READING_STORAGE_ROOT ||
    persisted.storageRoot ||
    join(homedir(), "Desktop", "Page2Reading");
  mkdirSync(storageRoot, { recursive: true });

  const authToken = process.env.PAGE2READING_TOKEN || persisted.authToken || randomBytes(24).toString("hex");
  const serverPort = Number(process.env.PAGE2READING_PORT || persisted.serverPort || 17321);

  return {
    storageRoot,
    configDir: dir,
    dbPath: join(dir, "page2reading.db"),
    serverPort,
    authToken,
    chromePath: detectChromePath(persisted.chromePath),
    maxConcurrentTasks: persisted.maxConcurrentTasks ?? 1,
    imageLoadTimeoutMs: persisted.imageLoadTimeoutMs ?? 15_000,
    htmlMaxBytes: 8_000_000,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    feishu: {
      appId: process.env.FEISHU_APP_ID || null,
      appSecret: process.env.FEISHU_APP_SECRET || null,
      appToken: process.env.FEISHU_BITABLE_APP_TOKEN || null,
      tableId: process.env.FEISHU_BITABLE_TABLE_ID || null,
    },
  };
}

export function sha256Short(input: string, len = 6): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}
