import { createHash } from "node:crypto";
import { db } from "./db";

export function hashAgentSecret(secret: string) {
  return createHash("sha256").update(`${secret}:${process.env.SESSION_SECRET}`).digest("hex");
}

export async function authenticateAgent(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const secret = authorization.slice(7).trim();
  if (!secret.startsWith("ops_agent_") || secret.length < 40) return null;
  const credential = await db.agentCredential.findUnique({
    where: { secretHash: hashAgentSecret(secret) },
    include: { device: { include: { organization: true, location: true } } },
  });
  if (!credential || credential.revokedAt) return null;
  await db.agentCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });
  return credential;
}

export function agentRequestContext(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("user-agent")?.slice(0, 160) ?? "agent";
}
