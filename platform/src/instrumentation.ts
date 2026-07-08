/**
 * Server error monitoring. Every uncaught server error (RSC render, route
 * handler, server action) lands here as one structured JSON log line with
 * route context — Vercel's log pipeline picks these up, and a log drain
 * (Axiom/Datadog/Betterstack) or SENTRY_DSN + @sentry/nextjs can alert on
 * them. See docs/DEPLOY.md §Observability.
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      event: "server.uncaught",
      message: e.message?.slice(0, 500),
      digest: e.digest,
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
      stack: e.stack?.split("\n").slice(0, 6).join(" | "),
    })
  );
};
