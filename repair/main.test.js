// node --test repair/main.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, diagnose, satisfies } from "./doctor.js";

test("fabric predicates", () => {
  const cases = [
    [">=0.5.8", "0.5.8", true], [">=0.5.8", "0.5.3", false],
    [">=1.20 <1.21", "1.20.1", true], [">=1.20 <1.21", "1.21", false],
    ["1.20.x", "1.20.4", true], ["1.20.x", "1.21", false],
    ["~1.2.3", "1.2.9", true], ["~1.2.3", "1.3.0", false],
    ["^0.15.0", "0.16.1", true], ["^0.15.0", "1.0.0", false],
    ["1.20.1", "1.20.1", true], ["1.20.1", "1.20.2", false],
    [">=0.5.0", "0.5.3+mc1.20.1", true], [">=1.0.0", "1.0.0-beta.2", false],
  ];
  for (const [p, v, want] of cases) assert.equal(satisfies({ kind: "fabric", value: [p] }, v), want, `${p} vs ${v}`);
  assert.ok(satisfies({ kind: "fabric", value: ["1.19.x", "1.20.x"] }, "1.20.1"), "any of the list");
  assert.ok(satisfies({ kind: "fabric", value: [">=9"] }, "${version}"), "templated version passes");
});

test("maven ranges", () => {
  const r = (value) => ({ kind: "maven", value });
  assert.ok(satisfies(r("[5.8.1,)"), "5.9"));
  assert.ok(!satisfies(r("[5.8.1,)"), "5.8"));
  assert.ok(satisfies(r("[1.0,2.0)"), "1.5"));
  assert.ok(!satisfies(r("[1.0,2.0)"), "2.0"));
  assert.ok(satisfies(r("(,2.0]"), "2.0"));
  assert.ok(satisfies(r("[1.20.1]"), "1.20.1"));
  assert.ok(!satisfies(r("[1.20.1]"), "1.20.2"));
  assert.ok(satisfies(r("[1,2),[3,4)"), "3.5"));
  assert.ok(satisfies(r("1.0"), "0.1"), "a bare version only recommends");
  assert.ok(satisfies(r("[15,)"), "1.20.1-15.2.0"), "game-version prefix is skipped");
});

test("fabric refusal", () => {
  const log = [
    "[12:00:01] [main/INFO]: Loading 80 mods",
    "[12:00:01] [main/WARN]: Mod 'Chatty' (chatty) 1.0 requires any version of mod 'Bogus' (bogus), which is missing!",
    "[12:00:02] [main/ERROR]: Incompatible mods found!",
    "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!",
    "\t - Install fabric-api, version 0.83.0 or later.",
    "\t - Mod 'Mod Menu' (modmenu) 7.2.2 requires version 0.83.0 or later of fabric-api, which is missing!",
    "\t - Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!",
    "\t - Mod 'Better F3' (betterf3) 1.0 is incompatible with any version of mod 'OptiFabric' (optifabric), but it is present: 1.13!",
  ].join("\n");
  const a = analyze(log, "");
  assert.ok(a.crashed);
  assert.deepEqual(a.findings, [
    { kind: "requires", by: "modmenu", dep: "fabric-api", wanted: "version 0.83.0 or later", present: null },
    { kind: "requires", by: "iris", dep: "sodium", wanted: "version 0.5.8 or later", present: "0.5.3" },
    { kind: "breaks", by: "betterf3", other: "optifabric" },
  ], "the WARN line is not a finding");
  assert.equal(a.cause, "net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!");
});

test("forge refusal and suspects", () => {
  const log = "[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n" +
    "\tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'\n" +
    "\tMod ID: 'minecraft', Requested by: 'jei', Expected range: '[1.20.1]', Actual version: '1.20.4'\n";
  const report = "---- Minecraft Crash Report ----\nDescription: Rendering overlay\n\njava.lang.NullPointerException: boom\n\tat x.y(Z.java:1)\n\n" +
    "Suspected Mods: \n\tSodium (sodium), Version: 0.5.3\n\t\tIssue tracker URL: https://x\n\tat TRANSFORMER/sodium@0.5.3/x\n\n" +
    "-- MOD rubidium --\nDetails:\n\tMod File: /x/rubidium.jar\n-- MOD minecraft --\n";
  const a = analyze(log, report);
  assert.deepEqual(a.findings, [
    { kind: "requires", by: "walkers", dep: "craftedcore", wanted: "[5.8.1,)", present: null },
    { kind: "requires", by: "jei", dep: "minecraft", wanted: "[1.20.1]", present: "1.20.4" },
    { kind: "culprit", id: "sodium" },
    { kind: "culprit", id: "rubidium" },
  ]);
  assert.equal(a.cause, "java.lang.NullPointerException: boom");
});

test("mixins, java, memory, driver; a clean session is not a crash", () => {
  const log = "[main/ERROR]: Mixin apply for mod sodium failed sodium.mixins.json:features.Foo from mod sodium -> net.minecraft.X\n" +
    "Caused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure in [lithium.mixins.json:ai.Bar]\n" +
    "java.lang.UnsupportedClassVersionError: x/Y has been compiled by a more recent version of the Java Runtime (class file version 65.0)\n" +
    "java.lang.OutOfMemoryError: Java heap space\n";
  assert.deepEqual(analyze(log, "# Problematic frame:\n# C  [atio6axx.dll+0x1234]\n").findings, [
    { kind: "culprit", id: "sodium" }, { kind: "mixin", config: "lithium.mixins.json" }, { kind: "java", needs: 21 }, { kind: "outOfMemory" }, { kind: "driver" },
  ]);
  const clean = "[main/INFO]: Loading\n[main/WARN]: Mixin apply for mod foo failed foo.mixins.json\n[main/INFO]: Stopping!\n";
  assert.deepEqual(analyze(clean, ""), { crashed: false, cause: null, findings: [] });
});

const jar = (file, id, version, depends = [], breaks = []) => ({
  file, enabled: true, foreign: null, broken: false,
  meta: {
    id, name: id, version, provides: [], mixins: [],
    depends: depends.map(([d, r]) => ({ id: d, range: r ? { kind: "fabric", value: [r] } : { kind: "any" } })),
    breaks: breaks.map((b) => ({ id: b, range: { kind: "any" } })),
  },
});

test("audit finds and fixes", () => {
  const mods = [
    jar("iris.jar", "iris", "1.7.0", [["sodium", ">=0.5.8"], ["fabricloader", ">=0.15"], ["minecraft", "1.20.1"]]),
    jar("sodium-0.5.3.jar", "sodium", "0.5.3", [["minecraft", "1.20.x"]]),
    jar("modmenu.jar", "modmenu", "7.2", [["fabric-api", ""]], ["optifabric"]),
    jar("optifabric.jar", "optifabric", "1.13"),
    jar("old-sodium-0.4.jar", "sodium", "0.4.10"),
    jar("legacy.jar", "legacy", "1", [["minecraft", "1.16.5"], ["java", ">=8"]]),
    { file: "jei.jar", enabled: true, meta: null, foreign: "Forge", broken: false },
    { file: "off.jar.disabled", enabled: false, meta: null, foreign: "Forge", broken: false },
  ];
  const d = diagnose({
    instance: { version: "1.20.1", loader: "fabric", loaderVersion: "0.14.0" },
    mods, missing: [{ path: "mods/a.jar", name: "a.jar", downloadable: true, page: null }], log: "", reports: "", launch: { ramMb: 4096, customJava: false },
  });
  const off = (file) => ({ kind: "disableMod", file });
  const got = Object.fromEntries(d.issues.map((i) => [i.key, i.fixes.map((f) => f.action)]));
  assert.deepEqual(got, {
    "duplicate:old-sodium-0.4.jar": [off("old-sodium-0.4.jar")],
    "version:iris:sodium": [{ kind: "updateMod", file: "sodium-0.5.3.jar" }, off("iris.jar")],
    "loader:iris": [{ kind: "updateLoader" }, off("iris.jar")],
    "missing:fabric-api": [{ kind: "installMod", id: "fabric-api" }, off("modmenu.jar")],
    "conflict:modmenu:optifabric": [off("optifabric.jar"), off("modmenu.jar")],
    "game:legacy.jar": [{ kind: "updateMod", file: "legacy.jar" }, off("legacy.jar")],
    "pack-files": [{ kind: "restorePackFiles" }],
    "foreign:jei.jar": [off("jei.jar")],
  });
  assert.equal(d.issues.at(-1).severity, "warning", "warnings come last");
});

test("crash findings join the audit's issue", () => {
  const log = "[main/ERROR]: Incompatible mods found!\n\t - Mod 'Mod Menu' (modmenu) 7.2.2 requires version 0.83.0 or later of fabric-api, which is missing!\n";
  const d = diagnose({
    instance: { version: "1.20.1", loader: "fabric", loaderVersion: "0.16.0" },
    mods: [jar("modmenu.jar", "modmenu", "7.2", [["fabric-api", ">=0.83.0"]]), jar("lithium.jar", "lithium", "0.11")],
    missing: [], log, reports: "", launch: { ramMb: 4096, customJava: false },
  });
  assert.equal(d.issues.length, 1, "the same problem once");
  assert.equal(d.issues[0].crash, true);
  const oom = diagnose({ instance: { version: "1.20.1", loader: "fabric", loaderVersion: "0.16" }, mods: [], missing: [], log: "java.lang.OutOfMemoryError: Java heap space\n", reports: "", launch: { ramMb: 4096, customJava: false } });
  assert.deepEqual(oom.issues[0].fixes[0].action, { kind: "setRam", mb: 6144 });
});
