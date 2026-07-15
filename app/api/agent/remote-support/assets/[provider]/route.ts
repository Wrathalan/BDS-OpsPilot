import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { authenticateAgent } from "@/lib/agent-auth";
import { remotePackagePath } from "@/lib/remote-support";

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });
  const { provider } = await params;
  if (provider !== "rustdesk") return NextResponse.json({ error: "Remote-support package was not recognized." }, { status: 404 });

  try {
    const executable = await readFile(remotePackagePath(provider));
    const digest = createHash("sha256").update(executable).digest("hex");
    return new Response(new Uint8Array(executable), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${provider}-windows-x64.exe"`,
        "Content-Length": executable.length.toString(),
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "X-Content-Type-Options": "nosniff",
        "X-OpsPilot-SHA256": digest,
      },
    });
  } catch {
    return NextResponse.json({ error: "The remote-support package is still being provisioned." }, { status: 503 });
  }
}
