// node --test mclogs
import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, tail, upload } from "./main.js";

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

test("classifies log lines and keeps stack traces with their error", () => {
  const levels = classify([
    "[12:00:00] [main/INFO]: Loading",
    "[12:00:01] [Render thread/WARN]: Missing texture",
    "[12:00:02] [main/ERROR]: Mod failed",
    "java.lang.NullPointerException: boom",
    "\tat foo.Bar.baz(Bar.java:1)",
    "Caused by: java.io.IOException",
    "\t... 3 more",
    "[12:00:03] [main/INFO]: Done",
  ].join("\n")).map((l) => l.level);
  assert.deepEqual(levels, ["info", "warn", "error", "error", "error", "error", "error", "info"]);
});
