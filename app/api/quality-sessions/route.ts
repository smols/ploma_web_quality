import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { qualitySessionSchema } from "@/lib/quality-session-schema";
import { listQualitySessions, loadQualitySession, saveQualitySession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Local access only." }, { status: 403 });
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId) {
    const session = await loadQualitySession(sessionId);
    if (!session) return NextResponse.json({ error: "Сессия quality-разметки не найдена." }, { status: 404 });
    return NextResponse.json({ session });
  }
  return NextResponse.json({ sessions: await listQualitySessions() });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Local access only." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Тело запроса должно быть JSON." }, { status: 400 });
  }
  const validation = qualitySessionSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Некорректная quality-сессия.", details: validation.error.flatten() }, { status: 400 });
  }
  try {
    const saved = await saveQualitySession(validation.data);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить quality-сессию.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
