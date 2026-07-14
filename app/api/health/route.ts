import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "healthy", mode: "live", database: "ready", time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "unhealthy", mode: "live", database: "unavailable" }, { status: 503 });
  }
}
