import assert from "node:assert/strict";
import test from "node:test";
import { isLocalRequest } from "@/lib/local-request";

test("local API guard accepts loopback requests", () => {
  const request = new Request("http://127.0.0.1:3000/api/sessions", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  });
  assert.equal(isLocalRequest(request), true);
});

test("local API guard rejects remote hosts and mismatched origins", () => {
  const remote = new Request("http://example.test/api/sessions", {
    headers: { host: "example.test", origin: "http://example.test" },
  });
  const mismatch = new Request("http://127.0.0.1:3000/api/sessions", {
    headers: { host: "127.0.0.1:3000", origin: "http://example.test" },
  });
  assert.equal(isLocalRequest(remote), false);
  assert.equal(isLocalRequest(mismatch), false);
});

test("local API guard accepts only the configured public origin through the loopback proxy", () => {
  const previous = process.env.APP_PUBLIC_ORIGIN;
  process.env.APP_PUBLIC_ORIGIN = "https://ploma.kognitiv.ru";
  try {
    const publicOrigin = new Request("http://127.0.0.1:3000/api/translate", {
      headers: { host: "127.0.0.1:3000", origin: "https://ploma.kognitiv.ru" },
    });
    const foreignOrigin = new Request("http://127.0.0.1:3000/api/translate", {
      headers: { host: "127.0.0.1:3000", origin: "https://attacker.example" },
    });
    assert.equal(isLocalRequest(publicOrigin), true);
    assert.equal(isLocalRequest(foreignOrigin), false);
  } finally {
    if (previous === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = previous;
  }
});
