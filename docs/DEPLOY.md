# Neumeric — Deployment

## Topology & domain strategy

- **Landing site** (repo root, static HTML) — Vercel project `neumericagritechsite`, deploys on push to `main`. Target domain: apex (`neumeric.xyz`).
- **Platform** (`platform/`, Next.js) — its own Vercel project (`neumeric-platform`), root directory `platform`. Target domain: **`app.neumeric.xyz`** (until DNS is set, `neumeric-platform.vercel.app`).
- Marketing → platform links are plain hyperlinks (sign in, legal pages) and one CORS-allowed API call (waitlist). Sessions live entirely on the platform origin — no cross-origin SSO complexity, and the static site stays static. This split is deliberate: the marketing site can be rebuilt freely without touching the authenticated app, and the app's CSP stays strict.
- **Database** — Turso (hosted libsql). Same schema/migrations as local dev; migrations run automatically at cold start.

## Environment variables (platform project on Vercel)

| Var | Required | Value |
|---|---|---|
| `TURSO_DATABASE_URL` | prod: yes | `libsql://<db-name>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | prod: yes | `turso db tokens create <db-name>` |
| `BLOB_READ_WRITE_TOKEN` | prod: yes | auto-set by linking the Vercel Blob store (`neumeric-evidence`) |
| `PROVENANCE_KEY` | prod: yes | random 32-byte hex — signs the provenance hash chain (rotating invalidates HMAC verification of prior entries; treat as long-lived) |
| `RESEND_API_KEY` | **launch dependency** | Resend API key — without it magic-link sign-in, invites, and waitlist confirmations cannot send in production (legacy workspace links still work) |
| `EMAIL_FROM` | with Resend | e.g. `Neumeric <hello@neumeric.xyz>` (domain must be verified in Resend) |
| `APP_ORIGIN` | recommended | canonical origin used in emailed links, e.g. `https://app.neumeric.xyz` |
| `FOUNDER_EMAILS` | optional | comma-separated emails allowed into `/growth` (default: founder address) |
| `UPLOAD_DIR` | dev only | `/tmp/uploads` fallback path; Blob is primary |

Without `TURSO_DATABASE_URL` the app falls back to a local SQLite file — fine on a laptop, broken on serverless.

## Observability

- **Structured logs**: every meaningful event is one JSON line (`src/lib/log.ts`); uncaught server errors are captured with route context by `instrumentation.ts`. Attach a Vercel **log drain** (Axiom/Datadog/Betterstack) for search + alerting, or add `@sentry/nextjs` with a DSN if preferred.
- **Health**: `GET /api/health` does a DB round-trip and reports the deployed commit; point an uptime monitor at it and alert on non-200.
- **Background jobs**: satellite scans run post-response via `after()` with status rows in the `jobs` table (UI polls `/api/jobs/[id]`). They share the invocation's `maxDuration` (300 s) — scan batches are sized to fit. A real queue (QStash/Inngest) is the upgrade path if job sizes grow.

## Database durability & backups

- Turso free tier: point-in-time restore is **limited**; the paid tier extends retention. **Before real-farmer scale, either move to a paid Turso plan or schedule `turso db shell neumeric-prod .dump` to object storage nightly.** This is a launch dependency, tracked in DEPENDENCIES.md.
- Migrations are forward-only (drizzle-kit), run at cold start. Test each migration against a copy of prod schema before deploying (`turso db create tmp --from-db neumeric-prod`, point a local run at it).
- Imagery bytes are content-addressed in Vercel Blob — verifiable against the SHA-256 recorded in the DB.

## Commands (once authenticated: `turso auth login`, `vercel login`)

```bash
# database
turso db create neumeric-prod
turso db show neumeric-prod --url        # → TURSO_DATABASE_URL
turso db tokens create neumeric-prod     # → TURSO_AUTH_TOKEN

# app
cd platform
vercel link
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add PROVENANCE_KEY production
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM production
vercel env add APP_ORIGIN production
vercel deploy --prod

# smoke checks after deploy
curl -s https://<deployment>/api/health          # {"ok":true,...}
npx tsx scripts/test-isolation.ts                # tenant isolation suite (local DB)
```

## Known production limitations (tracked honestly)

1. **Email delivery requires `RESEND_API_KEY`** — until set, magic links/invites/waitlist confirmations don't send in production. Legacy private links keep working, so pilot farmers are not locked out.
2. **Turso backup tier** — see Database durability above; confirm before scale.
3. **Migrations at cold start** — fine at pilot scale; move to a deploy-step migration once traffic is real.
4. **Satellite scans and serverless duration** — scans are background jobs batched ~20 scenes per run; click again to continue. Heavy backfills go through the CLI scripts (docs/ENGINES.md, Operational notes).
5. **No SMS reminders** — deadline emails become possible with Resend; SMS needs Twilio + TCPA consent flow (deliberately deferred).
