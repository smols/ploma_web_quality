import assert from "node:assert/strict";
import test from "node:test";
import { parseTranslationResponse, translateWithLuna } from "@/lib/luna";

test("parseTranslationResponse reads fenced JSON and returns translated title and text", () => {
  assert.deepEqual(
    parseTranslationResponse('```json\n{"title":"Заголовок","text":"Текст перевода"}\n```'),
    { title: "Заголовок", text: "Текст перевода" },
  );
});

test("parseTranslationResponse rejects an incomplete translation", () => {
  assert.throws(() => parseTranslationResponse('{"title":"Заголовок","text":" "}'), /строковые поля/);
});

test("translateWithLuna calls the configured chat completions API with the Luna model", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    calledInit = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"title":"Перевод заголовка","text":"Переведённый текст"}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await translateWithLuna(
    { title: "Original title", text: "Original body" },
    "test-secret",
    { baseUrl: "https://llm.example/v1/", fetcher },
  );

  assert.equal(calledUrl, "https://llm.example/v1/chat/completions");
  assert.equal(new Headers(calledInit?.headers).get("authorization"), "Bearer test-secret");
  const body = JSON.parse(String(calledInit?.body)) as { model: string; messages: Array<{ role: string }> };
  assert.equal(body.model, "gpt-6-luna");
  assert.deepEqual(body.messages.map((message) => message.role), ["system", "user"]);
  assert.deepEqual(result, { title: "Перевод заголовка", text: "Переведённый текст" });
});

test("translateWithLuna fails closed if deployment requires a proxy but none is configured", async () => {
  let called = false;
  await assert.rejects(
    translateWithLuna({ title: "Title", text: "Body" }, "secret", {
      requireProxy: true,
      fetcher: async () => {
        called = true;
        return new Response();
      },
    }),
    /proxy is required/,
  );
  assert.equal(called, false);
});
