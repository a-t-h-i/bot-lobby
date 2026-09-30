import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/client/api.ts";

type Call = { url: string; init: RequestInit };

function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("api posts JSON to the host route with the page's login cookie and returns the result", async () => {
  const calls = stubFetch(200, { ok: true, result: [{ id: "deepseek-official" }] });
  const result = await api<Array<{ id: string }>>("models", { refresh: true });
  assert.deepEqual(result, [{ id: "deepseek-official" }]);
  assert.equal(calls[0]?.url, "/bot-lobby/api/models");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(calls[0]?.init.credentials, "same-origin");
  assert.equal(calls[0]?.init.body, JSON.stringify({ refresh: true }));
});

test("api throws the host's error when the call is refused", async () => {
  stubFetch(401, { ok: false, error: "unauthorized" });
  await assert.rejects(api("models"), /unauthorized/);
});
