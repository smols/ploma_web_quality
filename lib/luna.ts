import { fetch as undiciFetch, ProxyAgent } from "undici";

export interface TextTranslation {
  title: string;
  text: string;
}

export function parseTranslationResponse(content: string): TextTranslation {
  let candidate = content.trim();
  if (candidate.startsWith("```")) {
    candidate = candidate.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Luna вернула ответ без JSON с переводом.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new Error("Не удалось разобрать перевод от Luna.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Luna вернула некорректный формат перевода.");
  const record = parsed as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.text !== "string" || !record.text.trim()) {
    throw new Error("В ответе Luna должны быть строковые поля title и text.");
  }
  return { title: record.title.trim(), text: record.text.trim() };
}

export async function translateWithLuna(
  input: { title: string; text: string },
  apiKey: string,
  options: { baseUrl?: string; proxyUrl?: string; requireProxy?: boolean; fetcher?: typeof fetch } = {},
): Promise<TextTranslation> {
  const baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (options.requireProxy && !options.proxyUrl) {
    throw new Error("VPN egress proxy is required but not configured.");
  }
  const proxyAgent = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : null;
  try {
    const requestBody = JSON.stringify({
        model: "gpt-6-luna",
        messages: [
          {
            role: "system",
            content: "Переведи заголовок и текст на естественный русский язык. Переводи полностью, без сокращений и пересказа. Сохраняй факты, имена, числа, даты, URL и структуру абзацев. Не добавляй пояснений. Верни только JSON-объект вида {\"title\":\"переведённый заголовок или пустая строка\",\"text\":\"полный перевод текста\"}.",
          },
          { role: "user", content: JSON.stringify(input) },
        ],
      });
    const headers = {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    };
    let response: Response;
    if (options.fetcher) {
      response = await options.fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      });
    } else if (proxyAgent) {
      response = await undiciFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
        dispatcher: proxyAgent,
      }) as unknown as Response;
    } else {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(120_000),
      });
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const details = payload && typeof payload === "object"
        ? (payload as { error?: { message?: unknown } }).error?.message
        : null;
      const message = typeof details === "string" ? details : `API Luna вернул HTTP ${response.status}.`;
      throw new Error(message.slice(0, 500));
    }
    const choices = payload && typeof payload === "object"
      ? (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices
      : undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Luna вернула пустой ответ.");
    return parseTranslationResponse(content);
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Истекло время ожидания ответа Luna.");
    }
    if (error instanceof Error && error.message !== "fetch failed") throw error;
    const cause = error instanceof Error ? (error as Error & { cause?: { code?: string; message?: string } }).cause : undefined;
    const reason = cause?.code || cause?.message || (error instanceof Error ? error.message : "connection error");
    throw new Error(`Не удалось связаться с API Luna (${String(reason).slice(0, 180)}).`);
  } finally {
    await proxyAgent?.close();
  }
}
