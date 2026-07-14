import { NextResponse } from "next/server";
import { clearSession, getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (user) await db.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.id, action: "user.logout", resourceType: "Session", resourceId: user.id, requestContext: request.headers.get("x-forwarded-for") ?? "local" } });
  await clearSession();
  return NextResponse.json({ ok: true });
}
