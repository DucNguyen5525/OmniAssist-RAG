import assert from "node:assert/strict";
import test from "node:test";
import { ResilientGCLIClient } from "./gemini";

test("disables a key after authentication rejection and does not select it again", async () => {
  const originalFetch = globalThis.fetch;
  let rejectedCalls = 0;
  let healthyCalls = 0;

  globalThis.fetch = async (_input, init) => {
    const authorization = new Headers(init?.headers).get("Authorization");
    if (authorization === "Bearer rejected-key") {
      rejectedCalls += 1;
      return new Response('{"error":{"message":"invalid API key"}}', { status: 401 });
    }
    healthyCalls += 1;
    return Response.json({ choices: [{ message: { content: "ok" } }] });
  };

  try {
    const client = new ResilientGCLIClient(
      [
        { key: "rejected-key", weight: 10, label: "rejected" },
        { key: "healthy-key", weight: 1, label: "healthy" }
      ],
      "https://gcli.example.test",
      "swrr"
    );

    assert.equal((await client.createChatCompletion("model", [])).content, "ok");
    assert.equal((await client.createChatCompletion("model", [])).content, "ok");
    assert.equal(rejectedCalls, 1);
    assert.equal(healthyCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
