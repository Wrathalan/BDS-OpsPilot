import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agent-auth";
import { db } from "@/lib/db";

const allowedAgentActions = new Set(["refresh-agent", "inventory-refresh"]);

export async function GET(request: Request) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });
  const runs = await db.automationRun.findMany({ where: { deviceId: credential.deviceId, status: "queued" }, include: { automation: true }, orderBy: { createdAt: "asc" }, take: 10 });
  return NextResponse.json({ tasks: runs.filter((run) => allowedAgentActions.has(run.automation.key)).map((run) => ({ id: run.id, action: run.automation.key, parameters: JSON.parse(run.input || "{}"), createdAt: run.createdAt })) });
}
