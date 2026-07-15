import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertOrganization, assertPermission, AuthorizationError } from "@/lib/rbac";
import { createRdpProfile, parseRdpEndpoint } from "@/lib/remote-support";

export async function GET(_request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  try {
    assertPermission(user, "remote.control");
    const { deviceId } = await params;
    const device = await db.device.findFirst({
      where: { id: deviceId, tenantId: user.tenantId },
      include: { remoteEndpoints: { where: { provider: "rdp" } } },
    });
    if (!device) return NextResponse.json({ error: "The endpoint was not found." }, { status: 404 });
    assertOrganization(user, device.organizationId);
    const endpoint = device.remoteEndpoints[0];
    if (endpoint?.status !== "ready") return NextResponse.json({ error: "Windows RDP is not ready on this endpoint." }, { status: 409 });

    const target = parseRdpEndpoint(endpoint.externalId);
    const profile = createRdpProfile(target.host, target.port);
    const filename = `${device.hostname.replace(/[^A-Za-z0-9._-]/g, "-") || "opspilot-endpoint"}.rdp`;
    return new Response(profile, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/x-rdp; charset=us-ascii",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The RDP profile could not be created." }, { status: error instanceof AuthorizationError ? 403 : 500 });
  }
}
