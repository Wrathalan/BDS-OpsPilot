import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertOrganization, assertPermission, AuthorizationError } from "@/lib/rbac";
import { createRustDeskDeepLink, decryptRemoteSecret, rustDeskPublicKey } from "@/lib/remote-support";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";

const schema = z.object({ deviceId: z.string().cuid(), provider: z.enum(["rustdesk", "rdp"]) });

function validateOrigin(request: Request) {
  if (!isTrustedBrowserOrigin(request)) throw new AuthorizationError("Request origin was not accepted.");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  try {
    validateOrigin(request);
    assertPermission(user, "remote.control");
    const input = schema.parse(await request.json());
    const device = await db.device.findFirst({
      where: { id: input.deviceId, tenantId: user.tenantId },
      include: { remoteEndpoints: { where: { provider: input.provider } } },
    });
    if (!device) return NextResponse.json({ error: "The endpoint was not found." }, { status: 404 });
    assertOrganization(user, device.organizationId);
    const endpoint = device.remoteEndpoints[0];
    if (!endpoint || endpoint.status !== "ready") return NextResponse.json({ error: `${input.provider === "rustdesk" ? "RustDesk" : "Windows RDP"} is not ready on this endpoint.` }, { status: 409 });

    let response: { provider: "rustdesk" | "rdp"; url: string; server: string };
    if (input.provider === "rustdesk") {
      if (!/^[A-Za-z0-9_-]{3,128}$/.test(endpoint.externalId)) throw new Error("The stored RustDesk identifier is invalid.");
      const idServer = process.env.RUSTDESK_ID_SERVER || endpoint.serverUrl;
      if (!/^[A-Za-z0-9.:[\]-]{3,200}$/.test(idServer)) throw new Error("The RustDesk ID server is invalid.");
      const key = await rustDeskPublicKey();
      if (!key) throw new Error("The RustDesk server public key is unavailable.");
      const password = endpoint.encryptedSecret ? decryptRemoteSecret(endpoint.encryptedSecret) : "";
      if (!password) throw new Error("The RustDesk endpoint password is unavailable. Keep the endpoint agent running so it can repair provider state.");
      response = {
        provider: "rustdesk",
        url: createRustDeskDeepLink(endpoint.externalId, idServer, key, password),
        server: idServer,
      };
    } else {
      response = {
        provider: "rdp",
        url: `/api/remote/rdp/${encodeURIComponent(device.id)}`,
        server: endpoint.externalId,
      };
    }

    await db.$transaction([
      db.agentSession.create({ data: { deviceId: device.id, type: `remote_${input.provider}`, status: "active", requestedBy: user.name } }),
      db.auditEvent.create({ data: { tenantId: user.tenantId, organizationId: device.organizationId, actorId: user.id, action: "remote.session_requested", resourceType: "Device", resourceId: device.id, requestContext: request.headers.get("x-forwarded-for")?.split(",")[0] || "local-browser", afterSummary: JSON.stringify({ provider: input.provider, externalId: endpoint.externalId }) } }),
    ]);
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The remote-session request was invalid." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The remote session could not be started." }, { status: error instanceof AuthorizationError ? 403 : 500 });
  }
}
