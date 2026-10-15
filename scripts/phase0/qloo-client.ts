import type { QlooEnv } from "./env.ts";
import { LIMITS } from "./config.ts";

export type Params = Record<string, string | number>;

/** One recorded request/response. The API key is never stored. */
export interface CallRecord {
  id: number;
  label: string;
  path: string;
  params: Params;
  requestedAt: string;
  durationMs: number;
  status: number;
  ok: boolean;
  attempts: number;
  error?: string;
  body: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class QlooClient {
  readonly calls: CallRecord[] = [];
  private readonly env: QlooEnv;

  constructor(env: QlooEnv) {
    this.env = env;
  }

  async get(label: string, path: string, params: Params): Promise<CallRecord> {
    const url = new URL(path, this.env.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const requestedAt = new Date().toISOString();
    const started = performance.now();
    let attempts = 0;
    let status = 0;
    let body: unknown = null;
    let error: string | undefined;

    while (attempts <= LIMITS.maxRetries) {
      attempts++;
      try {
        const res = await fetch(url, {
          headers: { "X-Api-Key": this.env.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
        });
        status = res.status;
        const text = await res.text();
        try {
          body = JSON.parse(text);
        } catch {
          body = text.slice(0, 2000);
        }
        error = res.ok ? undefined : `HTTP ${res.status}`;
        // Bounded retry only for rate limits / transient server errors.
        if (res.status === 429 || res.status >= 500) {
          await sleep(500 * 2 ** (attempts - 1));
          continue;
        }
        break;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        await sleep(500 * 2 ** (attempts - 1));
      }
    }

    const record: CallRecord = {
      id: this.calls.length + 1,
      label,
      path,
      params,
      requestedAt,
      durationMs: Math.round(performance.now() - started),
      status,
      ok: status >= 200 && status < 300,
      attempts,
      body,
      ...(error ? { error } : {}),
    };
    this.calls.push(record);

    const mark = record.ok ? "ok " : "ERR";
    console.log(`  [${mark}] #${record.id} ${status} ${record.durationMs}ms  ${label}`);
    await sleep(LIMITS.delayBetweenRequestsMs);
    return record;
  }
}
