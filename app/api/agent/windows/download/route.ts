import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashAgentSecret } from "@/lib/agent-auth";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertOrganization, assertPermission, AuthorizationError } from "@/lib/rbac";

const schema = z.object({ token: z.string().min(32).max(180) });
const marker = Buffer.from("OPSPILOT_ENROLLMENT_V1", "ascii");

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(process.env.APP_URL ?? request.url).origin;
  if (origin !== expected && origin !== "http://localhost:3000") throw new AuthorizationError("Request origin was not accepted.");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  try {
    validateOrigin(request);
    assertPermission(user, "device.manage");
    const { token } = schema.parse(await request.json());
    const enrollment = await db.enrollmentToken.findUnique({ where: { tokenHash: hashAgentSecret(token) } });
    if (!enrollment || enrollment.tenantId !== user.tenantId || enrollment.revokedAt || enrollment.expiresAt <= new Date() || enrollment.uses >= enrollment.maxUses)
      return NextResponse.json({ error: "Enrollment token is invalid, expired, revoked, or fully used." }, { status: 400 });
    assertOrganization(user, enrollment.organizationId);

    const server = new URL(process.env.AGENT_SERVER_URL ?? process.env.APP_URL ?? request.url).origin;
    const payload = Buffer.from(JSON.stringify({ server, token }), "utf8");
    const payloadLength = Buffer.allocUnsafe(4);
    payloadLength.writeUInt32LE(payload.length);
    const baseAgent = await readFile(path.join(process.cwd(), "public", "downloads", "opspilot-agent-windows-x64.exe"));
    const personalizedAgent = Buffer.concat([baseAgent, payload, payloadLength, marker]);
    const checksum = createHash("sha256").update(personalizedAgent).digest("hex");

    await db.auditEvent.create({
      data: {
        tenantId: user.tenantId,
        organizationId: enrollment.organizationId,
        actorId: user.id,
        action: "agent.package_downloaded",
        resourceType: "EnrollmentToken",
        resourceId: enrollment.id,
        requestContext: request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-browser",
        afterSummary: JSON.stringify({ server, tokenPrefix: enrollment.tokenPrefix, sha256: checksum }),
      },
    });

    return new Response(new Uint8Array(personalizedAgent), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="opspilot-agent-windows-x64.exe"',
        "Content-Length": personalizedAgent.length.toString(),
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "X-Content-Type-Options": "nosniff",
        "X-OpsPilot-Server": server,
        "X-OpsPilot-SHA256": checksum,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The agent download request was invalid." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The personalized agent could not be created." }, { status: error instanceof AuthorizationError ? 403 : 500 });
  }
}
