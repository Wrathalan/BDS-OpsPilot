import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientAddress, loginRateLimiter } from "@/lib/login-rate-limit";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";

const schema = z.object({ identifier: z.string().min(1).max(160), password: z.string().min(8).max(200) });
export async function POST(request: Request) {
  if (!isTrustedBrowserOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  const ip = clientAddress(request);
  try {
    const input = schema.parse(await request.json());
    const identifier = input.identifier.toLowerCase();
    if (loginRateLimiter.isBlocked(ip, identifier)) return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
    const user = await db.user.findFirst({ where: { active: true, OR: [{ username: identifier }, { email: identifier }] } });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      loginRateLimiter.recordFailure(ip, identifier);
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    loginRateLimiter.clear(ip, identifier);
    await createSession(user.id);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await db.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.id, action: "user.login", resourceType: "Session", resourceId: user.id, requestContext: ip, afterSummary: JSON.stringify({ method: "password", success: true }) } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enter a valid username or email and password." }, { status: 400 });
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 500 });
  }
}
