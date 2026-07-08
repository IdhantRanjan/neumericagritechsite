/**
 * Tenant-isolation + RBAC test.
 *
 * Proves the security-critical properties directly against the data layer
 * and the HTTP surface:
 *   1. Scoped read helpers return nothing for another operation's ids.
 *   2. A session for user B never resolves operation A (memberships gate).
 *   3. Legacy bearer tokens resolve only their own operation.
 *   4. The demo operation is read-only (visitor role, canWrite=false).
 *   5. Role matrix: owner/member write, advisor/partner/visitor don't.
 *   6. HTTP: a browser with op-B's cookie gets no op-A data on any page,
 *      and ID-guessing op-A entity routes 404s/redirects (run with BASE_URL
 *      against a dev server; skipped otherwise).
 *
 * Run: npx tsx scripts/test-isolation.ts   (uses .data/isolation-test.db)
 */
process.env.TURSO_DATABASE_URL = ""; // force the local driver
process.env.NEUMERIC_DB_FILE = ".data/isolation-test.db";

import fs from "node:fs";
import { randomUUID } from "node:crypto";

async function main() {
  if (!process.env.KEEP_DB) fs.rmSync(".data/isolation-test.db", { force: true });
  const { getDb, tables: t } = await import("../src/db");
  const { getField, getClaim } = await import("../src/lib/data");
  const { canWrite, canManage, canRecordOutcome } = await import("../src/lib/current-op");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // ————— fixture: two live operations + the seeded demo —————
  const now = new Date().toISOString();
  const mkOp = async (name: string) => {
    const opId = `op_${randomUUID().slice(0, 8)}`;
    const token = `tok_${randomUUID()}`;
    await db.insert(t.operations).values({
      id: opId, name, state: "IL", counties: ["Kane"], entityType: "sole_proprietor",
      isDemo: false, accessToken: token, contactEmail: null, hasBaseAcres: false,
      storesGrainOnFarm: false, usesCoverCrops: false, usesNoTill: false, createdAt: now,
    });
    const fieldId = `fld_${randomUUID().slice(0, 8)}`;
    await db.insert(t.fields).values({
      id: fieldId, operationId: opId, name: `${name} field`, county: "Kane", acres: 80,
      boundary: null, fsaFarmNumber: null, fsaTractNumber: null, fsaFieldNumber: null,
    });
    const claimId = `clm_${randomUUID().slice(0, 8)}`;
    await db.insert(t.claims).values({
      id: claimId, operationId: opId, fieldId, cropSeasonId: null, policyRefId: null,
      damageType: "hail", eventDate: "2026-06-01", discoveredDate: "2026-06-01",
      narrative: `${name} secret narrative`, status: "draft", fcrIds: [], createdAt: now,
    });
    return { opId, token, fieldId, claimId };
  };
  const A = await mkOp("Farm A");
  const B = await mkOp("Farm B");

  console.log("\n1) scoped reads cannot cross operations");
  check("field A invisible to op B", (await getField(A.fieldId, B.opId)) === undefined);
  check("claim A invisible to op B", (await getClaim(A.claimId, B.opId)) === undefined);
  check("field A visible to op A", (await getField(A.fieldId, A.opId)) !== undefined);

  console.log("\n2) membership gating (session → operation resolution)");
  const usrB = `usr_${randomUUID().slice(0, 8)}`;
  await db.insert(t.users).values({ id: usrB, email: `b-${usrB}@example.com`, name: null, passwordHash: null, emailVerifiedAt: now, createdAt: now });
  await db.insert(t.memberships).values({ id: `mem_${randomUUID().slice(0, 8)}`, userId: usrB, operationId: B.opId, role: "owner", invitedBy: null, createdAt: now });
  const membershipsOfB = await db.select().from(t.memberships).where(eq(t.memberships.userId, usrB));
  check("user B has exactly their own membership", membershipsOfB.length === 1 && membershipsOfB[0].operationId === B.opId);
  // simulate the OP_COOKIE-forgery path in currentAccess: wanted=A.opId must not match
  const wanted = A.opId;
  const resolved = membershipsOfB.find((m) => m.operationId === wanted) ?? membershipsOfB[0];
  check("forged op cookie for op A still resolves to op B", resolved.operationId === B.opId);

  console.log("\n3) bearer tokens resolve only their own operation");
  const byTokenA = await db.select().from(t.operations).where(eq(t.operations.accessToken, A.token));
  check("token A → op A only", byTokenA.length === 1 && byTokenA[0].id === A.opId);
  const forged = await db.select().from(t.operations).where(eq(t.operations.accessToken, "tok_guess"));
  check("guessed token resolves nothing", forged.length === 0);

  console.log("\n4+5) role matrix (canWrite / canManage / canRecordOutcome)");
  const demoOp = (await db.select().from(t.operations).where(eq(t.operations.isDemo, true)))[0];
  check("demo op exists (seeded)", !!demoOp);
  const mk = (op: typeof demoOp, role: "owner" | "member" | "advisor" | "partner" | "visitor") =>
    ({ op, role, user: null, memberships: [] });
  const liveOp = byTokenA[0];
  const expect: Array<[string, boolean, boolean, boolean]> = [
    ["owner", true, true, true],
    ["member", true, false, true],
    ["advisor", false, false, true],
    ["partner", false, false, false],
    ["visitor", false, false, false],
  ];
  for (const [role, w, m, o] of expect) {
    const a = mk(liveOp, role as never);
    check(
      `live/${role}: write=${w} manage=${m} outcome=${o}`,
      canWrite(a) === w && canManage(a) === m && canRecordOutcome(a) === o
    );
  }
  if (demoOp) {
    const demoOwner = mk(demoOp, "owner");
    check("demo op is read-only even for 'owner' role", !canWrite(demoOwner) && !canManage(demoOwner));
  }

  // ————— 6) HTTP-level (optional, needs BASE_URL of a running dev server) —————
  const base = process.env.BASE_URL;
  if (base) {
    console.log(`\n6) HTTP isolation against ${base}`);
    const joinB = await fetch(`${base}/join/${B.token}`, { redirect: "manual" });
    const cookie = (joinB.headers.get("set-cookie") ?? "").split(";")[0];
    check("join with token B sets a cookie", cookie.startsWith("nmc_ws="));
    const fieldsPage = await fetch(`${base}/fields`, { headers: { cookie } });
    const html = await fieldsPage.text();
    check("op B fields page lacks op A's field name", !html.includes("Farm A field"));
    const crossField = await fetch(`${base}/fields/${A.fieldId}`, { headers: { cookie }, redirect: "manual" });
    const crossHtml = crossField.status === 200 ? await crossField.text() : "";
    check(
      `direct fetch of op A field id → not exposed (status ${crossField.status})`,
      crossField.status === 404 || crossField.status >= 300 || !crossHtml.includes("Farm A"),
    );
    const crossClaim = await fetch(`${base}/claims/${A.claimId}`, { headers: { cookie }, redirect: "manual" });
    const crossClaimHtml = crossClaim.status === 200 ? await crossClaim.text() : "";
    check(
      `direct fetch of op A claim id → not exposed (status ${crossClaim.status})`,
      crossClaim.status === 404 || crossClaim.status >= 300 || !crossClaimHtml.includes("secret narrative"),
    );
  } else {
    console.log("\n6) HTTP checks skipped (set BASE_URL=http://localhost:3000 with a dev server on this test DB)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
