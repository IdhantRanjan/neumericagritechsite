/**
 * Resilient outbound calls. Every external dependency (STAC search, COG
 * byte-range reads, Open-Meteo, Resend, Blob) goes through here or through
 * withRetry so a transient 5xx/timeout doesn't fail a farmer-visible
 * request. Backoff is exponential with jitter; 4xx (except 429) never
 * retries — a bad request stays bad.
 */
import { log } from "@/lib/log";

export async function fetchWithRetry(
  url: string,
  init?: RequestInit & { tries?: number; timeoutMs?: number }
): Promise<Response> {
  const tries = init?.tries ?? 3;
  const timeoutMs = init?.timeoutMs ?? 20_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < tries - 1) {
      const delay = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  log.warn("net.retries_exhausted", { url: url.split("?")[0], error: String(lastErr) });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Retry an arbitrary async op (e.g. a windowed COG read via geotiff). */
export async function withRetry<T>(
  what: string,
  fn: () => Promise<T>,
  tries = 3
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < tries - 1) {
        const delay = Math.min(4000, 400 * 2 ** attempt) + Math.random() * 200;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  log.warn("net.retries_exhausted", { what, error: String(lastErr) });
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
