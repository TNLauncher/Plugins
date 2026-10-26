// node --test prism
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan } from "./main.js";

const pack = (components) => JSON.stringify({ formatVersion: 1, components });

test("reads a Prism export", () => {
  const p = plan({
    "mmc-pack.json": pack([{ uid: "net.minecraft", version: "1.21.1" }, { uid: "net.fabricmc.intermediary", version: "1.21.1" }, { uid: "net.fabricmc.fabric-loader", version: "0.16.5" }]),
    "instance.cfg": "InstanceType=OneSix\nname=My pack\n",
  });
  assert.deepEqual(p, { name: "My pack", gameVersion: "1.21.1", loader: "fabric", loaderVersion: "0.16.5", files: [], overrides: [".minecraft", "minecraft"] });
});

test("reads a MultiMC export wrapped in a folder", () => {
  const p = plan({ "Old/mmc-pack.json": pack([{ uid: "net.minecraft", cachedVersion: "1.12.2" }, { uid: "net.minecraftforge", version: "14.23.5.2860" }]) });
  assert.deepEqual([p.name, p.loader, p.overrides[0]], ["Old", "forge", "Old/.minecraft"]);
});

test("rejects other archives", () => {
  assert.throws(() => plan({ "modrinth.index.json": "{}" }), /Not a Prism/);
  assert.throws(() => plan({ "mmc-pack.json": pack([]) }), /which Minecraft/);
});
