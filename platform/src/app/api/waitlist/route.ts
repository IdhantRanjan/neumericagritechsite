/**
 * Waitlist capture — called from the marketing site (cross-origin) and the
 * platform's own pages. Double opt-in: signup lands as `pending`, the
 * confirmation email's link flips it to `confirmed`. Funnel status advances
 * to `onboarded` when the email later creates an operation (linked in
 * createOperation). Channel is recorded to answer the strategic question:
 * direct-to-farmer vs lender distribution — see /growth (owner dashboard).
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { issueToken } from "@/lib/auth";
import { sendWaitlistConfirm } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/log";

const ALLOWED_ORIGINS = new Set([
  "https://neumericagritechsite.vercel.app",
  "https://neumeric.xyz",
  "https://www.neumeric.xyz",
  "http://localhost:8000",
  "http://localhost:3000",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://neumeric.xyz";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  county: z.string().trim().max(80).optional(),
  acres: z.string().trim().max(20).optional(),
  channel: z.enum(["direct", "lender", "agent", "coop", "other"]).default("direct"),
});

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit("waitlist_ip", ip, 6, 60))) {
    return NextResponse.json(
      { error: "Too many signups from this connection — try again later." },
      { status: 429, headers }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
  }
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400, headers });
  }
  const s = parsed.data;

  const db = await getDb();
  const existing = (
    await db.select().from(t.waitlistSignups).where(eq(t.waitlistSignups.email, s.email))
  )[0];
  if (existing) {
    // idempotent: same message whether new or repeat, no enumeration signal
    return NextResponse.json(
      { ok: "Check your email to confirm your spot." },
      { status: 200, headers }
    );
  }

  await db.insert(t.waitlistSignups).values({
    id: `wl_${randomBytes(6).toString("hex")}`,
    email: s.email,
    name: s.name ?? null,
    state: s.state?.toUpperCase() ?? null,
    county: s.county ?? null,
    acres: s.acres ?? null,
    channel: s.channel,
    status: "pending",
    confirmedAt: null,
    onboardedOperationId: null,
    notes: null,
    createdAt: new Date().toISOString(),
  });

  const token = await issueToken({
    purpose: "waitlist_confirm",
    email: s.email,
    ttlMinutes: 7 * 24 * 60,
  });
  const sent = await sendWaitlistConfirm(s.email, token);
  log.info("waitlist.signup", { channel: s.channel, sent: sent.sent });

  return NextResponse.json(
    {
      ok: "Check your email to confirm your spot.",
      // dev affordance only — never present in production responses
      ...(sent.sent === false && sent.devLink ? { devLink: sent.devLink } : {}),
    },
    { status: 200, headers }
  );
}
