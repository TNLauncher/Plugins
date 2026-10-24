// node --test offline/main.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { activate, offlineUuid } from "./main.js";

test("offline uuid matches Mojang offline servers", () => {
  assert.equal(offlineUuid("Notch"), "b50ad385829d3141a2167e7d7539ba7f");
});

test("account provider validates username and returns legacy session", async () => {
  /** @type {any} */
  let provider = null;
  activate(/** @type {any} */ ({ accounts: { register: (p) => (provider = p) } }));
  assert.ok(provider);

  const logged = await provider.login({ username: "  Alex_1 " });
  assert.equal(logged.name, "Alex_1");
  assert.equal(logged.uuid, offlineUuid("Alex_1"));

  await assert.rejects(() => provider.login({ username: "ab" }), /3–16/);
  await assert.rejects(() => provider.login({ username: "bad name" }), /3–16/);

  const session = await provider.session({ name: logged.name, uuid: logged.uuid, data: null });
  assert.deepEqual(session, { name: "Alex_1", uuid: logged.uuid, token: "0", userType: "legacy" });
});
