import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../src/config.js";

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = mkdtempSync(join(tmpdir(), "p2r-"));
  const configDir = join(root, "cfg");
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "out"), { recursive: true });
  return {
    storageRoot: join(root, "out"),
    configDir,
    dbPath: join(configDir, "tasks.sqlite"),
    serverPort: 17321,
    authToken: "test-token",
    chromePath: null,
    maxConcurrentTasks: 1,
    imageLoadTimeoutMs: 1000,
    htmlMaxBytes: 8_000_000,
    deepseekApiKey: null,
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModel: "deepseek-flash",
    feishu: {
      appId: null,
      appSecret: null,
      appToken: null,
      tableId: null,
    },
    ...overrides,
  };
}
