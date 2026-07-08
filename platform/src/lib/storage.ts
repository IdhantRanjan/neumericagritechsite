/**
 * Content-addressed evidence storage (Hard Core 6).
 *
 * Every stored object is keyed by its SHA-256, so the hash recorded in the
 * capture row and committed into the provenance chain IS the storage key:
 * fetch the bytes, hash them, compare — integrity verification needs no
 * trust in this code.
 *
 * Backends:
 *  - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (durable, production)
 *  - local .data/uploads directory otherwise (dev)
 * The interface is deliberately three functions so swapping to R2/S3 is a
 * ~30-line adapter, not a refactor.
 */
import fs from "node:fs";
import path from "node:path";

export interface StoredObject {
  sha256: string;
  bytes: number;
  url: string | null; // public/durable URL when the backend provides one
  backend: "vercel-blob" | "local";
}

function localDir(): string {
  const dir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function putObject(sha256: string, buf: Buffer, contentType: string): Promise<StoredObject> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const res = await put(`evidence/${sha256}`, buf, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true, // same key = same content (content-addressed), overwrite is a no-op
    });
    return { sha256, bytes: buf.length, url: res.url, backend: "vercel-blob" };
  }
  const p = path.join(localDir(), sha256);
  fs.writeFileSync(p, buf);
  return { sha256, bytes: buf.length, url: null, backend: "local" };
}

export async function getObject(sha256: string, url: string | null): Promise<Buffer | null> {
  if (url) {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  const p = path.join(localDir(), sha256);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

/** Fetch + re-hash: returns true only if stored bytes still match their address. */
export async function verifyObject(sha256: string, url: string | null): Promise<boolean> {
  const buf = await getObject(sha256, url);
  if (!buf) return false;
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buf).digest("hex") === sha256;
}
