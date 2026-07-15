import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent, agentRequestContext } from "@/lib/agent-auth";
import { db } from "@/lib/db";

const schema = z.object({ status: z.enum(["succeeded", "failed"]), output: z.string().max(8000), failureReason: z.string().max(1000).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    const { id } = await params;
    const run = await db.automationRun.findFirst({ where: { id, deviceId: credential.deviceId, status: "queued" }, include: { automation: true } });
    if (!run || !["refresh-agent", "inventory-refresh"].includes(run.automation.key)) return NextResponse.json({ error: "Task was not found or is not executable by this agent." }, { status: 404 });
    const updated = await db.automationRun.update({ where: { id: run.id }, data: { status: input.status, output: input.output, failureReason: input.failureReason ?? null, startedAt: run.startedAt ?? new Date(), completedAt: new Date() } });
    await db.auditEvent.create({ data: { tenantId: credential.device.tenantId, organizationId: credential.device.organizationId, action: "agent.automation_completed", resourceType: "AutomationRun", resourceId: run.id, success: input.status === "succeeded", requestContext: agentRequestContext(request), afterSummary: JSON.stringify({ action: run.automation.key, status: input.status }) } });
    return NextResponse.json({ ok: true, run: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Task result payload was invalid." }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Task completion failed." }, { status: 500 });
  }
}
