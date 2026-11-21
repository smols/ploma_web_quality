import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { listSessions, loadSession, saveSession } from "@/lib/store";
import { reviewSessionSchema } from "@/lib/session-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Local access only." }, { status: 403 });
  }
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    const session = await loadSession(sessionId);
    if (!session) return NextResponse.json({ error: "Сессия не найдена." }, { status: 404 });
    return NextResponse.json({ session });
  }
  return NextResponse.json({ sessions: await listSessions() });
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Local access only." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Тело запроса должно быть JSON." }, { status: 400 });
  }
  const validation = reviewSessionSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Некорректная сессия разметки.", details: validation.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const saved = await saveSession(validation.data);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить сессию.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
