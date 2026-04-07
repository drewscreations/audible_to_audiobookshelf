import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { AppConfig } from "./types";

const CONFIG_PATH = join(/* turbopackIgnore: true */ process.cwd(), "data", "config.json");

const DEFAULT_CONFIG: AppConfig = {
  absUrl: process.env.ABS_URL || "http://100.96.84.62:13378",
  tokens: {},
  activeUser: "drew",
  libraries: [],
  batchSize: 250,
  finishThreshold: 0.99,
};

export function loadConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) {
    // Populate from env vars on first run
    const config = { ...DEFAULT_CONFIG };
    const envTokens: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (key.startsWith("ABS_TOKEN_") && val) {
        const user = key.replace("ABS_TOKEN_", "").toLowerCase();
        envTokens[user] = val;
      }
    }
    if (process.env.ABS_TOKEN) {
      envTokens["default"] = process.env.ABS_TOKEN;
    }
    config.tokens = envTokens;
    return config;
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const merged = { ...current, ...config };

  // Ensure data directory exists
  const dir = join(process.cwd(), "data");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("fs");
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

/** Get the active ABS token based on config */
export function getActiveToken(config?: AppConfig): string {
  const c = config || loadConfig();
  return c.tokens[c.activeUser] || c.tokens["default"] || "";
}
