"use server";

/**
 * Founder growth tools — CRM + funnel. Gated to founder emails (env
 * FOUNDER_EMAILS, comma-separated; falls back to the known founder address).
 * These are internal tools: no farmer data crosses into them beyond what the
 * waitlist form collected with consent.
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, tables as t } from "@/db";
import { resolveSession } from "@/lib/auth";

const now = () => new Date().toISOString();

export async function requireFounder() {
  const sess = await resolveSession();
  const allowed = (process.env.FOUNDER_EMAILS ?? "idhantran@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!sess || !allowed.includes(sess.user.email)) {
    throw new Error("Founder tools are restricted.");
  }
  return sess;
}

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  org: z.string().trim().max(120).optional(),
  county: z.string().trim().max(80).optional(),
  kind: z.enum(["farmer", "lender", "agent", "extension", "coop", "other"]).default("farmer"),
  source: z.string().trim().max(60).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional(),
  nextAction: z.string().trim().max(300).optional(),
  nextActionDate: z.string().trim().max(10).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function addContact(formData: FormData) {
  await requireFounder();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) throw new Error("Name is required; check the email format.");
  const c = parsed.data;
  const db = await getDb();
  await db.insert(t.crmContacts).values({
    id: `crm_${randomBytes(6).toString("hex")}`,
    name: c.name,
    org: c.org || null,
    county: c.county || null,
    kind: c.kind,
    source: c.source || null,
    stage: "identified",
    email: c.email || null,
    phone: c.phone || null,
    nextAction: c.nextAction || null,
    nextActionDate: c.nextActionDate || null,
    notes: c.notes || null,
    createdAt: now(),
    updatedAt: now(),
  });
  revalidatePath("/growth");
}

const STAGES = ["identified", "contacted", "replied", "meeting", "piloting", "passed"] as const;

export async function setContactStage(contactId: string, stage: string) {
  await requireFounder();
  if (!STAGES.includes(stage as (typeof STAGES)[number])) return;
  const db = await getDb();
  await db
    .update(t.crmContacts)
    .set({ stage, updatedAt: now() })
    .where(eq(t.crmContacts.id, contactId));
  revalidatePath("/growth");
}

export async function setContactNext(contactId: string, formData: FormData) {
  await requireFounder();
  const db = await getDb();
  await db
    .update(t.crmContacts)
    .set({
      nextAction: String(formData.get("nextAction") ?? "").slice(0, 300) || null,
      nextActionDate: String(formData.get("nextActionDate") ?? "").slice(0, 10) || null,
      notes: String(formData.get("notes") ?? "").slice(0, 2000) || null,
      updatedAt: now(),
    })
    .where(eq(t.crmContacts.id, contactId));
  revalidatePath("/growth");
}
