/**
 * Tamper-evident provenance chain (Hard Core 6).
 *
 * Every money-relevant artifact — imagery capture, field condition record,
 * trigger evaluation, ground-truth label — appends an entry that commits to
 * the previous entry's hash. Altering any historical record breaks every
 * subsequent entryHash, so "this evidence was not edited after the fact" is
 * verifiable by re-walking the chain, not asserted.
 *
 *   entryHash = sha256(seq | prevEntryHash | payloadSha256 | entityType |
 *                      entityId | action | at)
 *   hmac      = HMAC-SHA256(entryHash, PROVENANCE_KEY)
 *
 * The HMAC proves entries were written by a holder of the server key
 * (defends against DB-level tampering that rebuilds the whole chain).
 * Honest limitations, documented in docs/ENGINES.md §6: a key holder could
 * rebuild the chain, and timestamps are server-asserted — the next step is
 * asymmetric signing + RFC-3161/OpenTimestamps external anchoring so time
 * and integrity are verifiable without trusting Neumeric at all.
 */
import { createHash, createHmac } from "node:crypto";
import { desc } from "drizzle-orm";
import { tables as t, type DB } from "@/db";
import { canonicalJson } from "@/lib/satellite/methodology";

const GENESIS = "genesis";

function key(): string {
  // dev fallback is deterministic and clearly non-secret; set PROVENANCE_KEY in prod
  return process.env.PROVENANCE_KEY ?? "dev-only-provenance-key-not-for-production";
}

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function computeEntryHash(
  seq: number,
  prev: string,
  payloadSha256: string,
  entityType: string,
  entityId: string,
  action: string,
  at: string
): string {
  return createHash("sha256")
    .update(`${seq}|${prev}|${payloadSha256}|${entityType}|${entityId}|${action}|${at}`)
    .digest("hex");
}

/**
 * Append one entry. `payload` should be the canonical content of the entity
 * at write time (the FCR's numbers, the capture's byte hash, the trigger
 * trace) so the chain commits to the *data*, not just to an id.
 */
export async function appendProvenance(
  db: DB,
  entityType: string,
  entityId: string,
  action: string,
  payload: unknown
): Promise<{ seq: number; entryHash: string }> {
  const at = new Date().toISOString();
  const pHash = payloadHash(payload);
  const last = (
    await db.select().from(t.provenanceEntries).orderBy(desc(t.provenanceEntries.seq)).limit(1)
  )[0];
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.entryHash ?? GENESIS;
  const entryHash = computeEntryHash(seq, prev, pHash, entityType, entityId, action, at);
  const hmac = createHmac("sha256", key()).update(entryHash).digest("hex");
  await db.insert(t.provenanceEntries).values({
    seq,
    id: `prv_${seq}_${entryHash.slice(0, 8)}`,
    entityType,
    entityId,
    action,
    payloadSha256: pHash,
    prevEntryHash: prev,
    entryHash,
    hmac,
    at,
  });
  return { seq, entryHash };
}

export interface ChainVerification {
  ok: boolean;
  entries: number;
  headHash: string | null;
  firstBrokenSeq: number | null;
  problem: string | null;
}

/** Re-walk the whole chain and verify every link and HMAC. */
export async function verifyChain(db: DB): Promise<ChainVerification> {
  const rows = await db.select().from(t.provenanceEntries).orderBy(t.provenanceEntries.seq);
  let prev = GENESIS;
  for (const row of rows) {
    const expected = computeEntryHash(
      row.seq,
      prev,
      row.payloadSha256,
      row.entityType,
      row.entityId,
      row.action,
      row.at
    );
    if (expected !== row.entryHash) {
      return {
        ok: false,
        entries: rows.length,
        headHash: null,
        firstBrokenSeq: row.seq,
        problem: `entry hash mismatch at seq ${row.seq} — record altered after write`,
      };
    }
    const mac = createHmac("sha256", key()).update(row.entryHash).digest("hex");
    if (mac !== row.hmac) {
      return {
        ok: false,
        entries: rows.length,
        headHash: null,
        firstBrokenSeq: row.seq,
        problem: `HMAC mismatch at seq ${row.seq} — entry not signed by this server key`,
      };
    }
    if (row.prevEntryHash !== prev) {
      return {
        ok: false,
        entries: rows.length,
        headHash: null,
        firstBrokenSeq: row.seq,
        problem: `chain break at seq ${row.seq} — prev-hash does not match preceding entry`,
      };
    }
    prev = row.entryHash;
  }
  return { ok: true, entries: rows.length, headHash: prev === GENESIS ? null : prev, firstBrokenSeq: null, problem: null };
}

/** Entries for one entity, oldest first (for packet display). */
export async function entriesFor(db: DB, entityId: string) {
  const rows = await db.select().from(t.provenanceEntries).orderBy(t.provenanceEntries.seq);
  return rows.filter((r) => r.entityId === entityId);
}
