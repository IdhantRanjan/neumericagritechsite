# Neumeric — Deployment

## Topology

- **Landing site** (repo root, static HTML) — existing Vercel project (`neumericagritechsite`), deploys on push to `main`.
- **Platform** (`platform/`, Next.js) — its own Vercel project, root directory `platform`.
- **Database** — Turso (hosted libsql, SQLite-compatible). Same schema and migration files as local dev; migrations run automatically at cold start.

## Environment variables (platform project on Vercel)

| Var | Value |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://<db-name>-<org>.turso.io` |
| `TURSO_AUTH_TOKEN` | `turso db tokens create <db-name>` |
| `BLOB_READ_WRITE_TOKEN` | auto-set by linking a Vercel Blob store (`neumeric-evidence`) — durable content-addressed evidence storage |
| `PROVENANCE_KEY` | random 32-byte hex — signs the provenance hash chain (rotating it invalidates HMAC verification of prior entries; treat as long-lived) |
| `UPLOAD_DIR` | `/tmp/uploads` (dev-fallback path only; Blob is primary when its token exists) |

Without `TURSO_DATABASE_URL` the app falls back to a local SQLite file — fine on a laptop, broken on serverless (read-only filesystem). The env var is required in production.

## Commands (once authenticated: `turso auth login`, `vercel login`)

```bash
# database
turso db create neumeric-prod
turso db show neumeric-prod --url        # → TURSO_DATABASE_URL
turso db tokens create neumeric-prod     # → TURSO_AUTH_TOKEN

# app
cd platform
vercel link                              # create/link project
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add UPLOAD_DIR production     # /tmp/uploads
vercel deploy --prod
```

## Known production limitations (v0 — tracked in ROADMAP Phase 1)

1. **Workspace links are bearer tokens** — private-link access, not real auth. Magic-link email auth is the Phase 1 replacement. Links are unguessable (192-bit) and cookies are HttpOnly, but anyone with a link has access; treat links like keys.
2. **Migrations run at cold start** — simple and fine at pilot scale; move to a deploy-step migration once traffic is real.
3. **No email/SMS reminders yet** — deadline reminders need a Resend/Twilio key (Phase 1).
4. **Satellite scans and serverless duration** — scan pages set `maxDuration = 300`; scans are batched ~20 scenes per click. For a new field: scan from the field page first, then run claim analysis. Heavy backfills go through the CLI scripts (see docs/ENGINES.md, Operational notes).
