/**
 * Outbound email — magic links, invites, waitlist confirmations.
 *
 * Provider: Resend (RESEND_API_KEY + EMAIL_FROM env vars). Chosen because
 * it's a plain HTTPS API (no SDK weight) and the free tier covers pilot
 * volume. Swappable: everything goes through sendEmail().
 *
 * Without a key:
 *  - development: the link is logged to the server console and returned so
 *    the UI can show it (clearly marked as a dev affordance).
 *  - production: sends fail loudly. Configuring RESEND_API_KEY (or another
 *    provider) is a documented launch dependency — docs/DEPLOY.md.
 *
 * Compliance note: these are transactional emails (auth, confirmations).
 * Marketing/drip sequences live in docs/growth/ as drafts and are never
 * sent without explicit human approval + CAN-SPAM footer (unsubscribe +
 * physical address) — see docs/growth/README.md.
 */
import { log } from "@/lib/log";

export type EmailResult =
  | { sent: true }
  | { sent: false; devLink?: string; reason: string };

const FROM = process.env.EMAIL_FROM || "Neumeric <onboarding@resend.dev>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  /** the action link, surfaced in dev mode when no provider is configured */
  link?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      log.info("email.dev_fallback", { to: opts.to, subject: opts.subject, link: opts.link });
      return { sent: false, devLink: opts.link, reason: "no_provider_dev" };
    }
    log.error("email.no_provider", { to: opts.to, subject: opts.subject });
    return { sent: false, reason: "no_provider" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [opts.to], subject: opts.subject, text: opts.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.error("email.send_failed", { status: res.status, body: (await res.text()).slice(0, 300) });
      return { sent: false, reason: `provider_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    log.error("email.send_error", { error: String(e) });
    return { sent: false, reason: "network" };
  }
}

export function appOrigin(): string {
  return (
    process.env.APP_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

export async function sendMagicLink(email: string, token: string): Promise<EmailResult> {
  const link = `${appOrigin()}/auth/verify?token=${token}`;
  return sendEmail({
    to: email,
    subject: "Your Neumeric sign-in link",
    text: [
      "Here's your sign-in link for Neumeric:",
      "",
      link,
      "",
      "It works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email — nobody can sign in without it.",
      "",
      "— Neumeric",
    ].join("\n"),
    link,
  });
}

export async function sendInvite(
  email: string,
  token: string,
  operationName: string,
  role: string
): Promise<EmailResult> {
  const link = `${appOrigin()}/auth/verify?token=${token}&invite=1`;
  return sendEmail({
    to: email,
    subject: `You've been added to ${operationName} on Neumeric`,
    text: [
      `You've been invited to join ${operationName} on Neumeric as ${role === "advisor" ? "an advisor" : `a ${role}`}.`,
      "",
      `Accept the invite: ${link}`,
      "",
      "The link expires in 7 days. Neumeric is a farm platform for insurance deadlines, claim evidence, program money, and grain-marketing decision support.",
      "",
      "— Neumeric",
    ].join("\n"),
    link,
  });
}

export async function sendWaitlistConfirm(email: string, token: string): Promise<EmailResult> {
  const link = `${appOrigin()}/api/waitlist/confirm?token=${token}`;
  return sendEmail({
    to: email,
    subject: "Confirm your spot on the Neumeric early-access list",
    text: [
      "One click to confirm you want early access to Neumeric:",
      "",
      link,
      "",
      "If you didn't sign up, ignore this email and you won't hear from us again.",
      "",
      "— Neumeric",
    ].join("\n"),
    link,
  });
}
