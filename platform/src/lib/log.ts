/**
 * Structured logging — one JSON line per event, which Vercel's log pipeline
 * (and any drain: Datadog, Axiom, Betterstack) ingests as structured data.
 * Use these instead of bare console.* anywhere behavior matters.
 *
 * Error monitoring: instrumentation.ts registers onRequestError, so every
 * uncaught server error lands here with route context. Point a Vercel log
 * drain (or set SENTRY_DSN and add @sentry/nextjs) at this stream for
 * alerting — documented in docs/DEPLOY.md §Observability.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};
