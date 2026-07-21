import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent, agentRequestContext } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { encryptRemoteSecret, remotePackageAvailable, remoteServerUrl, rustDeskPublicKey } from "@/lib/remote-support";

const reportSchema = z.object({
  providers: z.array(z.object({
    provider: z.enum(["rustdesk", "rdp"]),
    externalId: z.string().min(1).max(240),
    status: z.enum(["ready", "failed"]),
    secret: z.string().min(12).max(200).optional(),
    error: z.string().max(1000).optional(),
    version: z.string().max(80).optional(),
  })).min(1).max(2),
});

export async function GET(request: Request) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });

  const [rustAsset, rustKey, installed] = await Promise.all([
    remotePackageAvailable("rustdesk"),
    rustDeskPublicKey(),
    db.remoteEndpoint.findMany({ where: { deviceId: credential.deviceId } }),
  ]);
  const current = new Map(installed.map((item) => [item.provider, { externalId: item.externalId, status: item.status, lastVerifiedAt: item.lastVerifiedAt }]));
  const rustdeskIdServer = process.env.RUSTDESK_ID_SERVER || "";
  const rustdeskRelayServer = process.env.RUSTDESK_RELAY_SERVER || "";
  const rustdeskDisabledReason = !rustAsset
    ? "The RustDesk client package is unavailable on the control plane."
    : !rustdeskIdServer
      ? "The RustDesk ID server is not configured on the control plane."
      : !rustdeskRelayServer
        ? "The RustDesk relay server is not configured on the control plane."
        : !rustKey
          ? "The RustDesk public key is unavailable on the control plane."
          : null;

  return NextResponse.json({
    providers: {
      rustdesk: {
        enabled: rustdeskDisabledReason === null,
        disabledReason: rustdeskDisabledReason,
        assetUrl: "/api/agent/remote-support/assets/rustdesk",
        idServer: rustdeskIdServer,
        relayServer: rustdeskRelayServer,
        key: rustKey,
        current: current.get("rustdesk") || null,
      },
      rdp: {
        enabled: process.env.RDP_FALLBACK_ENABLED !== "false",
        assetUrl: "",
        server: "",
        current: current.get("rdp") || null,
      },
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });

  try {
    const input = reportSchema.parse(await request.json());
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.remoteEndpoint.deleteMany({ where: { deviceId: credential.deviceId, provider: "meshcentral" } });
      for (const report of input.providers) {
        const encryptedSecret = report.secret ? encryptRemoteSecret(report.secret) : undefined;
        const serverUrl = report.provider === "rdp" ? report.externalId : remoteServerUrl(report.provider);
        await tx.remoteEndpoint.upsert({
          where: { deviceId_provider: { deviceId: credential.deviceId, provider: report.provider } },
          create: {
            deviceId: credential.deviceId,
            provider: report.provider,
            externalId: report.externalId,
            status: report.status,
            serverUrl,
            encryptedSecret,
            details: JSON.stringify({ error: report.error || null, version: report.version || null }),
            installedAt: report.status === "ready" ? now : null,
            lastVerifiedAt: now,
          },
          update: {
            externalId: report.externalId,
            status: report.status,
            serverUrl,
            ...(encryptedSecret ? { encryptedSecret } : {}),
            details: JSON.stringify({ error: report.error || null, version: report.version || null }),
            ...(report.status === "ready" ? { installedAt: now } : {}),
            lastVerifiedAt: now,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          tenantId: credential.device.tenantId,
          organizationId: credential.device.organizationId,
          action: "remote.providers_reported",
          resourceType: "Device",
          resourceId: credential.deviceId,
          requestContext: agentRequestContext(request),
          afterSummary: JSON.stringify(input.providers.map(({ provider, externalId, status, error, version }) => ({ provider, externalId, status, error, version }))),
        },
      });
    });
    return NextResponse.json({ accepted: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "The remote-support report was invalid.", details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The remote-support report failed." }, { status: 500 });
  }
}
