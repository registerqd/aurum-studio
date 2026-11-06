import { NextResponse } from "next/server";
import { listWorks, writeWork } from "@/lib/server/work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const works = await listWorks();
  return NextResponse.json({ works });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const payload = body as { id?: string; title?: string; document?: unknown };
  if (!payload || payload.document === undefined) {
    return NextResponse.json({ error: "document is required" }, { status: 400 });
  }

  const saved = await writeWork({
    id: payload.id,
    title: payload.title,
    document: payload.document,
  });
  return NextResponse.json({ work: { ...saved, document: undefined } }, { status: 201 });
}
