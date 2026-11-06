import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "aurum-studio",
    version: process.env.npm_package_version ?? "1.1.0",
    storage: process.env.AURUM_DATA_DIR ? "custom" : "local",
    time: new Date().toISOString(),
  });
}
