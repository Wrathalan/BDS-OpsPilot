import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { loadUser, type SessionUser } from "./rbac";
import { shouldUseSecureSessionCookie } from "./session-cookie";

export const SESSION_COOKIE = "opspilot_session";
const sessionDays = 1;
const tokenHash = (token: string) => createHash("sha256").update(`${token}:${process.env.SESSION_SECRET}`).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000);
  await db.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: shouldUseSecureSessionCookie(), path: "/", expires: expiresAt });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!session || session.expiresAt <= new Date()) return null;
  return loadUser(session.userId);
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
