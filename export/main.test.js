// node --test export
import assert from "node:assert/strict";
import { test } from "node:test";
import { exportInstance, mrpackIndex, prismFiles, survey } from "./main.js";

const inst = { name: "Pack", version: "1.21.1", loader: "fabric", loaderVersion: "0.16.5" };

test("builds a Modrinth index", () => {
  const i = mrpackIndex(inst, [{ path: "mods/a.jar", sha1: "s1", sha512: "s5", url: "https://cdn.modrinth.com/a.jar", size: 3 }]);
  assert.deepEqual(i.dependencies, { minecraft: "1.21.1", "fabric-loader": "0.16.5" });
  assert.deepEqual(i.files[0], { path: "mods/a.jar", hashes: { sha1: "s1", sha512: "s5" }, downloads: ["https://cdn.modrinth.com/a.jar"], fileSize: 3 });
  assert.deepEqual(mrpackIndex({ ...inst, loader: "vanilla" }, []).dependencies, { minecraft: "1.21.1" });
  assert.throws(() => mrpackIndex({ ...inst, loader: "liteloader" }, []));
});

test("builds Prism files", () => {
  const f = prismFiles(inst);
  assert.match(f["instance.cfg"], /^name=Pack$/m);
  assert.deepEqual(JSON.parse(f["mmc-pack.json"]).components.map((c) => c.uid), ["net.minecraft", "net.fabricmc.fabric-loader"]);
});

test("links hosted mods and leaves them out of overrides", async () => {
  let spec;
  const tn = {
    instances: { get: async () => inst, export: async (_, s) => ((spec = s), "/tmp/Pack.mrpack") },
    content: { hashes: async (_, kind) => (kind === "mod" ? { "a.jar": "aaa", "b.jar": "bbb", "c.jar.disabled": "ccc" } : {}) },
    net: {
      fetch: async () => ({
        ok: true,
        json: () => ({ aaa: { files: [{ hashes: { sha1: "aaa", sha512: "A" }, url: "https://cdn.modrinth.com/a.jar", size: 1 }] } }),
      }),
    },
  };
  assert.equal(await exportInstance(tn, "i", { format: "mrpack", worlds: false }), "/tmp/Pack.mrpack");
  assert.deepEqual(JSON.parse(spec.files["modrinth.index.json"]).files.map((f) => f.path), ["mods/a.jar"]);
  assert.ok(spec.skip.includes("mods/a.jar") && spec.skip.includes("mods/c.jar.disabled") && spec.skip.includes("saves"));
  assert.ok(!spec.skip.includes("mods/b.jar"));
});

test("surveys what is linked, copied and left out, and survives Modrinth being down", async () => {
  const tn = (fetch) => ({
    instances: { get: async () => inst },
    content: { hashes: async (_, kind) => (kind === "shader" ? { "s.zip": "sss" } : kind === "mod" ? { "a.jar": "aaa", "b.jar.disabled": "bbb" } : {}) },
    net: { fetch },
  });
  const up = await survey(tn(async () => ({ ok: true, json: () => ({ aaa: { files: [{ hashes: { sha1: "aaa", sha512: "A" }, url: "u", size: 1 }] } }) })), "i");
  assert.deepEqual([up.kinds.mod.hosted.length, up.kinds.mod.off, up.kinds.shader.copied, up.lookupError], [1, ["b.jar.disabled"], ["s.zip"], ""]);
  const down = await survey(tn(async () => { throw new Error("offline"); }), "i");
  assert.deepEqual([down.kinds.mod.copied, down.lookupError], [["a.jar"], "offline"]);
});
