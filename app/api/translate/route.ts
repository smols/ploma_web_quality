import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalRequest } from "@/lib/local-request";
import { translateWithLuna } from "@/lib/luna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const translationRequestSchema = z.object({
  title: z.string().max(10_000).default(""),
  text: z.string().trim().min(1).max(50_000),
}).strict();

const API_KEY_PATH = process.env.OPENAI_API_KEY_FILE || path.resolve(process.cwd(), "..", ".secrets", "openai-key");

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
  const parsed = translationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Передайте текст публикации (не более 50 000 символов)." }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = (await readFile(API_KEY_PATH, "utf8")).trim();
  } catch {
    return NextResponse.json({ error: "API-ключ не найден. Проверьте OPENAI_API_KEY_FILE на сервере." }, { status: 503 });
  }
  if (!apiKey) return NextResponse.json({ error: "Файл API-ключа пуст." }, { status: 503 });

  try {
    const translation = await translateWithLuna(parsed.data, apiKey, {
      baseUrl: process.env.OPENAI_BASE_URL,
      proxyUrl: process.env.OPENAI_PROXY_URL,
      requireProxy: process.env.REQUIRE_OPENAI_PROXY === "true",
    });
    return NextResponse.json({ translation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось перевести текст.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
