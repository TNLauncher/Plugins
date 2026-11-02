// node --test horizon/main.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { builds, files, launch, platform } from "./main.js";

const asset = (name, digest = "sha256:ab12") => ({ name, browser_download_url: `https://github.com/horizon-rust/horizon/releases/download/x/${name}`, digest });
const releases = [
  { name: "Horizon launcher 0.2.36", tag_name: "launcher@0.2.36", assets: [] },
  { name: "Nightly 2026-11-01 · 4aa6854", tag_name: "nightly-2026-11-01", assets: [asset("horizon-linux-x86_64.tar.gz"), asset("horizon-windows-x64.zip", null)] },
  { name: "Nightly 2026-11-01 · c9d474d", tag_name: "nightly", assets: [asset("horizon-linux-x86_64.tar.gz", "sha256:ff")] },
  { name: "Nightly 2026-11-01 · c9d474d", tag_name: "nightly-copy", assets: [] },
  { name: "Nightly 2026-10-31 · d91cab6", tag_name: "nightly-2026-10-31", assets: [] },
];

test("lists game builds newest first, once each", () => {
  assert.deepEqual(builds(releases).map((b) => b.id), ["2026-11-01-c9d474d", "2026-11-01-4aa6854", "2026-10-31-d91cab6"]);
  assert.equal(builds(releases)[0].release.tag_name, "nightly");
});

test("picks the platform archive with its sha256", () => {
  const ctx = { version: "2026-11-01-c9d474d", os: "linux", arch: "x86_64" };
  assert.deepEqual(files(releases, ctx), [{ url: "https://github.com/horizon-rust/horizon/releases/download/x/horizon-linux-x86_64.tar.gz", filename: "horizon-linux-x86_64.tar.gz", sha256: "ff", extract: true }]);
  assert.throws(() => files(releases, { ...ctx, version: "2020-01-01-0000000" }), /no longer on GitHub/);
  assert.throws(() => files(releases, { version: "2026-11-01-4aa6854", os: "windows", arch: "x86_64" }), /no checked/);
  assert.throws(() => platform("linux", "aarch64"), /no build for linux aarch64/);
  assert.equal(platform("windows", "x86_64").archive, "horizon-windows-x64.zip");
});

test("prepares, then starts with the account on stdin", () => {
  const ctx = { version: "v", os: "windows", arch: "x86_64", width: 854, height: 480, fullscreen: true, world: "My World" };
  const l = launch(ctx);
  assert.equal(l.serverJar, true);
  assert.equal(l.steps[0].program, "horizon-windows-x64/horizon-prepare.exe");
  assert.deepEqual(l.steps[0].check, ["--check", "--output", "${runtime}/prepared"]);
  assert.equal(l.game.program, "horizon-windows-x64/horizon-client.exe");
  assert.equal(l.game.session, "stdin");
  assert.deepEqual(l.game.args.slice(6), ["--width", "854", "--height", "480", "--fullscreen", "--quickPlaySingleplayer", "My World", "--session-stdin"]);
  const plain = launch({ ...ctx, os: "linux", fullscreen: false, world: null });
  assert.ok(!plain.game.args.includes("--fullscreen") && !plain.game.args.includes("--quickPlaySingleplayer"));
});
