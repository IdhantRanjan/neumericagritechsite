import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, tables as t } from "@/db";
import { WS_COOKIE } from "@/lib/current-op";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = await getDb();
  const op = (
    await db.select().from(t.operations).where(eq(t.operations.accessToken, token)).limit(1)
  )[0];
  const url = new URL(request.url);
  if (!op) {
    return NextResponse.redirect(new URL("/welcome?invalid=1", url.origin));
  }
  const res = NextResponse.redirect(new URL("/", url.origin));
  res.cookies.set(WS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return res;
}
