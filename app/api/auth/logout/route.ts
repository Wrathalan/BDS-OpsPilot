import { NextResponse } from "next/server";
import { clearSession, getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientAddress } from "@/lib/login-rate-limit";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  if (!isTrustedBrowserOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  const user = await getSessionUser();
  if (user) await db.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.id, action: "user.logout", resourceType: "Session", resourceId: user.id, requestContext: clientAddress(request) } });
  await clearSession();
  return NextResponse.json({ ok: true });
}
