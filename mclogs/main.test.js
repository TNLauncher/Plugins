// node --test mclogs
import assert from "node:assert/strict";
import { test } from "node:test";
import { tail, upload } from "./main.js";

test("keeps the end of long logs", () => {
  assert.equal(tail("a\nb\nc", 2), "b\nc");
  assert.equal(tail("a\nb", 5), "a\nb");
});

test("uploads form-encoded and reports errors", async () => {
  let sent;
  const tn = (answer) => ({ net: { fetch: async (url, init) => ((sent = { url, init }), { status: 200, json: () => answer }) } });
  assert.equal(await upload(tn({ success: true, url: "https://mclo.gs/x" }), "a&b"), "https://mclo.gs/x");
  assert.equal(sent.init.body, "content=a%26b");
  await assert.rejects(upload(tn({ success: false, error: "too big" }), "x"), /too big/);
});
