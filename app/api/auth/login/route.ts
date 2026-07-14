import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({ email: z.email().max(160), password: z.string().min(8).max(200) });
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const current = attempts.get(ip);
  if (current && current.resetAt > Date.now() && current.count >= 8) return NextResponse.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  try {
    const input = schema.parse(await request.json());
    const user = await db.user.findFirst({ where: { email: input.email.toLowerCase(), active: true } });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      attempts.set(ip, { count: (current?.resetAt ?? 0) > Date.now() ? current!.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 });
      return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    attempts.delete(ip);
    await createSession(user.id);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await db.auditEvent.create({ data: { tenantId: user.tenantId, actorId: user.id, action: "user.login", resourceType: "Session", resourceId: user.id, requestContext: ip, afterSummary: JSON.stringify({ method: "password", success: true }) } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 500 });
  }
}
