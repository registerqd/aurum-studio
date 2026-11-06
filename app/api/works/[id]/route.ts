import { NextResponse } from "next/server";
import { deleteWork, readWork, writeWork } from "@/lib/server/work-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const work = await readWork(id);
  if (!work) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ work });
}

export async function PUT(request: Request, context: Context) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const payload = body as { title?: string; document?: unknown };
  if (payload?.document === undefined) {
    return NextResponse.json({ error: "document is required" }, { status: 400 });
  }
  const saved = await writeWork({ id, title: payload.title, document: payload.document });
  return NextResponse.json({ work: { ...saved, document: undefined } });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const removed = await deleteWork(id);
  if (!removed) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
