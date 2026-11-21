import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalRequest } from "@/lib/local-request";
import { qualitySessionSchema } from "@/lib/quality-session-schema";
import { applyQualitySessionPatch } from "@/lib/quality-session";
import { listQualitySessions, loadQualitySession, saveQualitySession } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const qualitySessionPatchSchema = z.object({
  sessionId: z.string().uuid(),
  currentStoryId: z.string().min(1).nullable().optional(),
  judgments: z.array(z.object({
    key: z.string().min(1),
    humanLabel: z.enum(["belongs", "not_belongs", "uncertain"]).nullable().optional(),
    note: z.string().optional(),
  }).strict().refine((patch) => patch.humanLabel !== undefined || patch.note !== undefined, {
    message: "Укажите изменение метки или заметки.",
  })).max(1000).optional(),
}).strict().refine((patch) =>
  patch.currentStoryId !== undefined || Boolean(patch.judgments?.length),
{ message: "Изменения сессии не заданы." });

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

export async function PATCH(request: Request) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Local access only." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Тело запроса должно быть JSON." }, { status: 400 });
  }
  const validation = qualitySessionPatchSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: "Некорректное изменение quality-сессии.", details: validation.error.flatten() }, { status: 400 });
  }
  const session = await loadQualitySession(validation.data.sessionId);
  if (!session) return NextResponse.json({ error: "Сессия quality-разметки не найдена." }, { status: 404 });
  try {
    const updated = applyQualitySessionPatch(session, validation.data);
    const saved = await saveQualitySession(updated);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить quality-сессию.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
