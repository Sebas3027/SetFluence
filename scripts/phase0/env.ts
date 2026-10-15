import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface QlooEnv {
  baseUrl: string;
  apiKey: string;
}

/** Loads .env (if present) and resolves Qloo settings. Accepts canonical and legacy variable names. */
export function loadQlooEnv(rootDir: string): QlooEnv {
  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const apiKey = (process.env.QLOO_API_KEY ?? process.env.API_Key ?? "").trim();
  const baseUrl = (process.env.QLOO_BASE_URL ?? process.env.QLOO_URL ?? "https://hackathon.api.qloo.com")
    .trim()
    .replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("Missing Qloo API key. Set QLOO_API_KEY (or legacy API_Key) in .env.");
  }
  if (!baseUrl.startsWith("https://hackathon.api.qloo.com")) {
    console.warn(`[env] Warning: base URL is ${baseUrl}. Hackathon keys only work on https://hackathon.api.qloo.com`);
  }
  return { baseUrl, apiKey };
}
