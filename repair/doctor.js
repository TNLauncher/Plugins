// @ts-check
// What is wrong with a build and how to fix it. Pure functions over what the launcher reports; `page.js` runs them.
/** @typedef {import("../packages/plugin-api").ModEntry} ModEntry */
/** @typedef {import("../packages/plugin-api").ModMeta} ModMeta */
/** @typedef {import("../packages/plugin-api").MissingFile} MissingFile */
/** @typedef {import("../packages/plugin-api").Range} Range */
/** @typedef {import("../packages/plugin-api").Instance} Instance */

/**
 * @typedef {{ kind: "installMod"; id: string }
 *   | { kind: "updateMod"; file: string }
 *   | { kind: "disableMod"; file: string }
 *   | { kind: "deleteMod"; file: string }
 *   | { kind: "restorePackFiles" }
 *   | { kind: "updateLoader" }
 *   | { kind: "setRam"; mb: number }
 *   | { kind: "autoJava" }} Action
 * @typedef {{ label: string; action: Action }} Fix
 * @typedef {"missing" | "version" | "game" | "loader" | "conflict" | "duplicate" | "foreign" | "broken" | "packFiles" | "culprit" | "java" | "memory" | "driver" | "crash"} IssueKind
 * @typedef {{ key: string; kind: IssueKind; severity: "error" | "warning"; title: string; detail: string; fixes: Fix[]; crash: boolean }} Issue
 * @typedef {{ kind: "requires"; by: string; dep: string; wanted: string; present: string | null }
 *   | { kind: "breaks"; by: string; other: string }
 *   | { kind: "culprit"; id: string }
 *   | { kind: "mixin"; config: string }
 *   | { kind: "java"; needs: number }
 *   | { kind: "outOfMemory" } | { kind: "heapReserve" } | { kind: "driver" }} Finding
 */

/** Ids every loader resolves on its own: never a mod to install or blame. */
export const PLATFORM_IDS = ["minecraft", "java", "fabricloader", "fabric-loader", "quilt_loader", "forge", "neoforge", "fml", "javafml", "lowcodefml", "mcp", "mixinextras"];
/** Above this an out-of-memory crash is a leak, not a small heap. */
const MAX_SUGGESTED_RAM_MB = 12288;

const LOADER_LABEL = /** @type {Record<string, string>} */ ({ vanilla: "Minecraft", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", liteloader: "LiteLoader" });
const LOADER_IDS = /** @type {Record<string, string[]>} */ ({ fabric: ["fabricloader", "fabric-loader"], quilt: ["quilt_loader"], forge: ["forge"], neoforge: ["neoforge"] });

// ─── Versions ──────────────────────────────────────────────────────────────

/** @param {string} s */
function parts(s) {
  const core = s.split("+")[0];
  const dash = core.indexOf("-");
  const nums = (/** @type {string} */ x) => (x.match(/\d+/g) ?? []).map(Number);
  return { core: nums(dash < 0 ? core : core.slice(0, dash)), pre: dash < 0 ? null : nums(core.slice(dash + 1)) };
}

/** @param {number[]} a @param {number[]} b */
function cmpNums(a, b, pad = true) {
  const len = pad ? Math.max(a.length, b.length) : Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return pad ? 0 : Math.sign(a.length - b.length);
}

/** Numeric parts of a version; build metadata (`+mc1.20`) is dropped, a pre-release sorts before its release. @param {string} a @param {string} b */
export function cmp(a, b) {
  const x = parts(a), y = parts(b);
  const c = cmpNums(x.core, y.core);
  if (c) return c;
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return cmpNums(x.pre, y.pre, false);
}

/** @param {string} pred @param {string} v */
function fabricSingle(pred, v) {
  pred = pred.trim();
  if (!pred || pred === "*") return true;
  const op = [">=", "<=", ">", "<", "=", "~", "^"].find((o) => pred.startsWith(o)) ?? "";
  const rest = pred.slice(op.length).trim();
  const ps = rest.split(".");
  // `1.20.x`: every version starting with 1.20.
  const wild = ps.findIndex((p) => p === "x" || p === "X" || p === "*");
  if (wild >= 0) {
    const have = v.split(/[.+-]/);
    return have.length >= wild && ps.slice(0, wild).every((w, i) => cmp(w, have[i]) === 0);
  }
  const o = cmp(v, rest);
  const n = ps.map((p) => Number(p.match(/^\d+/)?.[0] ?? 0));
  switch (op) {
    case ">=": return o >= 0;
    case "<=": return o <= 0;
    case ">": return o > 0;
    case "<": return o < 0;
    case "~": return o >= 0 && cmp(v, `${n[0]}.${(n[1] ?? 0) + 1}`) < 0;
    case "^": return o >= 0 && cmp(v, `${n[0] + 1}`) < 0;
    default: return o === 0;
  }
}

/** @param {string} spec @param {string} v */
function mavenOk(spec, v) {
  spec = spec.trim();
  // A bare version is a recommendation the loader does not enforce.
  if (!spec.startsWith("[") && !spec.startsWith("(")) return true;
  const groups = spec.match(/[[(][^\])]*[\])]/g) ?? [];
  return groups.some((g) => {
    const loInc = g[0] === "[", hiInc = g.at(-1) === "]";
    const inner = g.slice(1, -1);
    const [lo, hi] = inner.includes(",") ? inner.split(",").map((x) => x.trim()) : [inner, inner];
    const loOk = !lo || cmp(v, lo) > 0 || (loInc && cmp(v, lo) === 0);
    const hiOk = !hi || cmp(v, hi) < 0 || (hiInc && cmp(v, hi) === 0);
    return loOk && hiOk;
  });
}

/** Whether `version` meets `range`. Unknown or templated versions pass: a wrong "missing" is worse than a quiet miss. @param {Range} range @param {string} version */
export function satisfies(range, version) {
  if (!version || version.includes("$")) return true;
  const check = (/** @type {string} */ v) =>
    range.kind === "any" ? true : range.kind === "fabric" ? range.value.some((p) => p.split(/\s+/).every((one) => fabricSingle(one, v))) : mavenOk(range.value, v);
  // Forge jars often prefix the game version: `1.20.1-15.2.0`.
  const dash = version.indexOf("-");
  return check(version) || (dash > 0 && /^\d/.test(version.slice(dash + 1)) && check(version.slice(dash + 1)));
}

/** @param {Range} range */
export const describe = (range) => (range.kind === "any" ? "" : range.kind === "fabric" ? range.value.join(" or ") : range.value);

// ─── Crash logs ────────────────────────────────────────────────────────────

const CRASH_MARKERS = [
  "---- Minecraft Crash Report ----",
  "#@!@# Game crashed!",
  'Exception in thread "main"',
  "FormattedException",
  "Incompatible mods found!",
  "Missing or unsupported mandatory dependencies",
  "LoadingFailedException",
  "ModLoadingException",
  "Mod loading has failed",
  "java.lang.OutOfMemoryError",
  "UnsupportedClassVersionError",
  "Could not reserve enough space",
  "A fatal error has been detected by the Java Runtime",
];
const DRIVER_MARKERS = [
  "Pixel format not accelerated", "GLFW error 65542", "WGL: The driver does not appear to support OpenGL", "Couldn't set pixel format",
  "atio6axx", "atioglxx", "nvoglv", "libnvidia-glcore", "iris_dri", "radeonsi_dri", "ig9icd", "ig75icd", "ig7icd", "ig8icd",
];

/** `[12:00:00] [main/WARN]:`: true for info-level headers, false for errors, null for lines without one. @param {string} line */
function level(line) {
  const t = line.trimStart();
  if (!t.startsWith("[")) return null;
  const head = t.split("]: ")[0].slice(0, 120).toLowerCase();
  if (["/info]", "/warn]", "/debug]", "/trace]", "[info]", "[warn]", "[debug]"].some((m) => head.includes(m))) return true;
  if (["/error]", "/fatal]", "[error]", "[fatal]", "[severe]"].some((m) => head.includes(m))) return false;
  return null;
}

/** Lines logged at error level, with the stack traces and messages that follow them. @param {string} log */
function loud(log) {
  let benign = false;
  return log.split(/\r?\n/).filter((l) => {
    const b = level(l);
    if (b !== null) benign = b;
    return !benign;
  });
}

/** A mod id as loaders print it. @param {string} s */
function idToken(s) {
  const id = (s.match(/^[A-Za-z0-9_.-]+/)?.[0] ?? "").replace(/\.+$/, "").toLowerCase();
  return id || null;
}

/** `'Name' (id)`, `mod 'Name' (id)` or a bare id at the start of `s`. @param {string} s */
function target(s) {
  s = s.trim().replace(/^mod /, "");
  if (!s.startsWith("'")) return idToken(s);
  const at = s.indexOf("' (");
  return at < 0 ? null : idToken(s.slice(at + 3));
}

/** Fabric/Quilt: `- Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!` @param {string} line @returns {Finding | null} */
function fabricRelation(line) {
  const t = line.trim().replace(/^-+/, "").trim();
  if (!t.startsWith("Mod '")) return null;
  const rest = t.slice(5);
  const nameEnd = rest.indexOf("' (");
  if (nameEnd < 0) return null;
  const afterName = rest.slice(nameEnd + 3);
  const by = idToken(afterName);
  const close = afterName.indexOf(")");
  if (!by || close < 0) return null;
  const after = afterName.slice(close + 1);
  const req = after.indexOf(" requires ");
  if (req >= 0) {
    const tail = after.slice(req + 10);
    const of = tail.indexOf(" of ");
    if (of < 0) return null;
    const dep = target(tail.slice(of + 4));
    const p = tail.indexOf("present: ");
    const present = p < 0 ? null : tail.slice(p + 9).replace(/!$/, "").split(/[,!]/)[0].trim();
    return dep ? { kind: "requires", by, dep, wanted: tail.slice(0, of).trim(), present } : null;
  }
  const verb = [" is incompatible with ", " breaks "].find((v) => after.includes(v));
  if (!verb) return null;
  const tail = after.slice(after.indexOf(verb) + verb.length);
  const of = tail.indexOf(" of ");
  const other = target(of < 0 ? tail : tail.slice(of + 4));
  return other ? { kind: "breaks", by, other } : null;
}

/** Forge/NeoForge: `Mod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'` @param {string} line @returns {Finding | null} */
function forgeRequirement(line) {
  const field = (/** @type {string} */ key) => line.match(new RegExp(`${key}\\s*'([^']*)'`))?.[1].trim() ?? null;
  const dep = field("Mod ID:"), by = field("Requested by:");
  if (!dep || !by) return null;
  const actual = field("Actual version:");
  const present = actual && !/^\[missing\]$|^null$/i.test(actual) ? actual : null;
  return { kind: "requires", by: by.toLowerCase(), dep: dep.toLowerCase(), wanted: field("Expected range:") ?? "", present };
}

/** @param {string} line @returns {Finding | null} */
function mixinFinding(line) {
  const low = line.toLowerCase();
  if (!low.includes("mixin")) return null;
  for (const key of ["Mixin apply for mod ", " from mod "]) {
    const at = line.indexOf(key);
    if (at >= 0) {
      const id = idToken(line.slice(at + key.length));
      return id ? { kind: "culprit", id } : null;
    }
  }
  const config = line.match(/[A-Za-z0-9_.-]+\.mixins\.json/)?.[0];
  return config ? { kind: "mixin", config } : null;
}

/** `Name (id)` → id. @param {string} s */
const parenId = (s) => {
  const m = s.match(/ \(([^)]*)\)/);
  return m ? idToken(m[1]) : null;
};

/** Mods a crash report names: `Suspected Mods:`, `-- MOD id --`, `-- Mod loading issue for: id --`. @param {string} report @param {Finding[]} out */
function reportCulprits(report, out) {
  let suspects = false;
  for (const line of report.split(/\r?\n/)) {
    const t = line.trim();
    const mod = t.match(/^-- (?:MOD |Mod loading issue for: )(.*)/);
    if (mod) {
      const id = idToken(mod[1]);
      if (id) push(out, { kind: "culprit", id });
      continue;
    }
    const sus = t.match(/^Suspected Mods?:(.*)/);
    if (sus) {
      suspects = sus[1].trim().toLowerCase() !== "none";
      const id = parenId(sus[1]);
      if (id) push(out, { kind: "culprit", id });
      continue;
    }
    if (!suspects) continue;
    // `\tSodium (sodium), Version: 0.5.3`; deeper lines are its URL and stack frames.
    if (!t || !/^[\t ]/.test(line)) suspects = false;
    else if (!line.startsWith("\t\t") && !line.startsWith("    ")) {
      const id = parenId(t);
      if (id) push(out, { kind: "culprit", id });
    }
  }
}

/** @param {Finding[]} out @param {Finding} f */
function push(out, f) {
  const who = f.kind === "culprit" ? f.id : f.kind === "requires" || f.kind === "breaks" ? f.by : null;
  if (who && PLATFORM_IDS.includes(who)) return;
  if (!out.some((x) => JSON.stringify(x) === JSON.stringify(f))) out.push(f);
}

/** The exception in one line: the crash report's, else the deepest `Caused by` of the log, else its first exception. @param {string[]} lines @param {string} report */
function cause(lines, report) {
  const exception = (/** @type {string} */ l) => {
    const t = l.trim();
    const cls = t.split(":")[0];
    return !t.startsWith("at ") && (t.includes("Exception") || t.includes("Error:")) && cls.includes(".") && !cls.includes(" ");
  };
  const rep = report.split(/\r?\n/);
  const d = rep.findIndex((l) => l.startsWith("Description:"));
  let line = d >= 0 ? rep.slice(d + 1).find(exception) : undefined;
  line ??= lines.findLast((l) => l.trim().startsWith("Caused by: "))?.trim().slice("Caused by: ".length);
  line ??= lines.find(exception);
  if (!line) return null;
  line = line.trim();
  return line.length > 240 ? line.slice(0, 240) + "…" : line;
}

/** `log`: the session's output; `report`: the crash report and JVM error file written during it. @param {string} log @param {string} report */
export function analyze(log, report) {
  const crashed = report.trim() !== "" || CRASH_MARKERS.some((m) => log.includes(m));
  if (!crashed) return { crashed: false, cause: null, findings: /** @type {Finding[]} */ ([]) };
  const lines = loud(log);
  /** @type {Finding[]} */
  const findings = [];
  for (const line of [...lines, ...report.split(/\r?\n/)]) {
    const f = fabricRelation(line) ?? (line.includes("Requested by:") ? forgeRequirement(line) : null) ?? mixinFinding(line);
    if (f) push(findings, f);
    if (line.includes("UnsupportedClassVersionError") || line.includes("Unsupported class file major version")) {
      const n = Number(line.match(/(?:class file version|Unsupported class file major version) (\d+)/)?.[1]);
      if (n > 44) push(findings, { kind: "java", needs: n - 44 });
    }
    if (line.includes("java.lang.OutOfMemoryError")) push(findings, { kind: "outOfMemory" });
    if (line.includes("Could not reserve enough space")) push(findings, { kind: "heapReserve" });
    if (DRIVER_MARKERS.some((m) => line.includes(m))) push(findings, { kind: "driver" });
  }
  reportCulprits(report, findings);
  return { crashed, cause: cause(lines, report), findings };
}

// ─── Diagnosis ─────────────────────────────────────────────────────────────

/** @param {string} label @param {Action} action @returns {Fix} */
const fix = (label, action) => ({ label, action });
/** @param {string} name @param {string} file */
const offFix = (name, file) => fix(`Turn off ${name}`, { kind: "disableMod", file });
const gb = (/** @type {number} */ mb) => `${+(mb / 1024).toFixed(1)} GB`;

/** Everything installed by id: mods, what they bundle, and the platform itself. @param {Pick<Instance, "version" | "loader" | "loaderVersion">} inst @param {{ file: string; meta: ModMeta }[]} jars */
function index(inst, jars) {
  /** @type {Map<string, { version: string; file: string | null }>} */
  const ids = new Map();
  /** @type {Map<string, string>} */
  const names = new Map();
  // Bundled ids first, so a jar's own id wins over a copy bundled in another jar.
  for (const j of jars) for (const [id, v] of j.meta.provides) if (!ids.has(id)) ids.set(id, { version: v, file: j.file });
  // Two copies of one mod: point at the newest, the one a fix keeps.
  /** @type {Map<string, string>} */
  const own = new Map();
  for (const j of jars) {
    const seen = own.get(j.meta.id);
    if (seen !== undefined && cmp(j.meta.version, seen) <= 0) continue;
    own.set(j.meta.id, j.meta.version);
    ids.set(j.meta.id, { version: j.meta.version, file: j.file });
    names.set(j.meta.id, j.meta.name);
  }
  // The platform: an empty version meets any range.
  for (const id of PLATFORM_IDS) ids.set(id, { version: "", file: null });
  ids.set("minecraft", { version: inst.version, file: null });
  for (const id of LOADER_IDS[inst.loader] ?? []) ids.set(id, { version: inst.loaderVersion, file: null });
  names.set("minecraft", "Minecraft");
  return {
    ids,
    file: (/** @type {string} */ id) => ids.get(id)?.file ?? null,
    name: (/** @type {string} */ id) => names.get(id) ?? id,
  };
}

/** Adds `issue`, or marks the one already found with its key as seen in the crash too. @param {Issue[]} issues @param {Issue | null} issue */
function add(issues, issue) {
  if (!issue) return;
  const found = issues.find((i) => i.key === issue.key);
  if (found) found.crash ||= issue.crash;
  else issues.push(issue);
}

/** @param {Pick<Instance, "version" | "loader" | "loaderVersion">} inst @param {ReturnType<typeof index>} idx @param {string} by @param {string} dep @param {string} wanted @param {string | null} present @param {boolean} crash @returns {Issue | null} */
function requirement(inst, idx, by, dep, wanted, present, crash) {
  if (dep === "java") return null;
  const byFile = idx.file(by);
  const byName = idx.name(by);
  const off = byFile ? [offFix(byName, byFile)] : [];
  const tail = wanted ? ` (${wanted})` : "";
  /** @param {string} key @param {IssueKind} kind @param {string} title @param {string} detail @param {Fix[]} fixes @returns {Issue} */
  const issue = (key, kind, title, detail, fixes) => ({ key, kind, severity: "error", title, detail, fixes, crash });
  if (dep === "minecraft") {
    if (!byFile) return null;
    return issue(`game:${byFile}`, "game", `${byName} is made for another Minecraft version`, `It wants Minecraft${tail}, this instance runs ${inst.version}.`, [
      fix(`Get ${byName} for ${inst.version}`, { kind: "updateMod", file: byFile }),
      ...off,
    ]);
  }
  if ((LOADER_IDS[inst.loader] ?? []).includes(dep)) {
    const loader = LOADER_LABEL[inst.loader];
    return issue(`loader:${by}`, "loader", `${byName} needs a newer ${loader}`, `It wants ${loader}${tail}, this instance has ${inst.loaderVersion}.`, [
      fix(`Update ${loader}`, { kind: "updateLoader" }),
      ...off,
    ]);
  }
  if (!idx.ids.has(dep)) {
    return issue(`missing:${dep}`, "missing", `${byName} needs ${dep}`, `${dep}${tail} is not installed.`, [fix(`Install ${dep}`, { kind: "installMod", id: dep }), ...off]);
  }
  const depFile = idx.file(dep);
  if (!depFile) return null;
  const depName = idx.name(dep);
  const have = present ?? idx.ids.get(dep)?.version ?? "";
  return issue(`version:${by}:${dep}`, "version", `${byName} needs another version of ${depName}`, `It wants ${depName}${tail}, ${have} is installed.`, [
    fix(`Update ${depName}`, { kind: "updateMod", file: depFile }),
    ...off,
  ]);
}

/** @param {ReturnType<typeof index>} idx @param {string} by @param {string} other @param {boolean} crash @returns {Issue | null} */
function conflict(idx, by, other, crash) {
  const byFile = idx.file(by), otherFile = idx.file(other);
  if (!byFile || !otherFile || byFile === otherFile) return null;
  const [byName, otherName] = [idx.name(by), idx.name(other)];
  return {
    key: `conflict:${[by, other].sort().join(":")}`,
    kind: "conflict",
    severity: "error",
    title: `${byName} does not work with ${otherName}`,
    detail: `${byName} declares ${otherName} incompatible. Keep one of them.`,
    fixes: [offFix(otherName, otherFile), offFix(byName, byFile)],
    crash,
  };
}

/** @param {ReturnType<typeof index>} idx @param {string} id @returns {Issue | null} */
function culprit(idx, id) {
  const file = idx.file(id);
  if (!file) return null;
  const name = idx.name(id);
  return {
    key: `culprit:${file}`,
    kind: "culprit",
    severity: "error",
    title: `${name} crashed the game`,
    detail: "The crash points at this mod. A newer build often fixes it; turning it off always does.",
    fixes: [fix(`Update ${name}`, { kind: "updateMod", file }), offFix(name, file)],
    crash: true,
  };
}

/**
 * Everything wrong with an instance, most urgent first.
 * @param {{
 *   instance: Pick<Instance, "version" | "loader" | "loaderVersion">;
 *   mods: ModEntry[];
 *   missing: MissingFile[];
 *   log: string;
 *   reports: string;
 *   launch: { ramMb: number; customJava: boolean };
 * }} input
 */
export function diagnose({ instance: inst, mods, missing, log, reports, launch }) {
  /** @type {Issue[]} */
  const issues = [];
  const on = mods.filter((m) => m.enabled);
  const jars = on.flatMap((m) => (m.meta ? [{ file: m.file, meta: m.meta }] : []));
  const idx = index(inst, jars);

  for (const m of on.filter((m) => m.broken)) {
    add(issues, {
      key: `broken:${m.file}`, kind: "broken", severity: "error", title: `${m.file} is damaged`,
      detail: "It is not a readable jar, so the loader will fail on it. Repair restores pack files; anything else has to go.",
      fixes: [fix("Delete", { kind: "deleteMod", file: m.file })], crash: false,
    });
  }

  // Duplicates: keep the newest copy.
  /** @type {Map<string, typeof jars>} */
  const byId = new Map();
  for (const j of jars) byId.set(j.meta.id, [...(byId.get(j.meta.id) ?? []), j]);
  for (const [id, copies] of byId) {
    if (copies.length < 2) continue;
    const newest = copies.reduce((a, b) => (cmp(b.meta.version, a.meta.version) > 0 ? b : a));
    for (const extra of copies.filter((j) => j.file !== newest.file)) {
      add(issues, {
        key: `duplicate:${extra.file}`, kind: "duplicate", severity: "error", title: `${idx.name(id)} is installed twice`,
        detail: `${extra.file} and ${newest.file} are the same mod; loaders refuse to start with both.`,
        fixes: [fix("Remove this copy", { kind: "disableMod", file: extra.file })], crash: false,
      });
    }
  }

  for (const j of jars) {
    for (const d of j.meta.depends) {
      const have = idx.ids.get(d.id);
      if (!have) add(issues, requirement(inst, idx, j.meta.id, d.id, describe(d.range), null, false));
      else if (!satisfies(d.range, have.version)) add(issues, requirement(inst, idx, j.meta.id, d.id, describe(d.range), have.version, false));
    }
    for (const b of j.meta.breaks) {
      const have = idx.ids.get(b.id);
      if (have?.file && have.version && (b.range.kind === "any" || satisfies(b.range, have.version))) add(issues, conflict(idx, j.meta.id, b.id, false));
    }
  }

  // Sinytra Connector runs Fabric mods on Forge/NeoForge.
  const connector = idx.ids.has("connector");
  for (const m of on.filter((m) => m.foreign && !(connector && m.foreign === "Fabric"))) {
    add(issues, {
      key: `foreign:${m.file}`, kind: "foreign", severity: "warning", title: `${m.file} is a ${m.foreign} mod`,
      detail: `${LOADER_LABEL[inst.loader]} skips it, so whatever needs it will not find it.`,
      fixes: [fix("Turn off", { kind: "disableMod", file: m.file })], crash: false,
    });
  }

  const auto = missing.filter((f) => f.downloadable);
  const byHand = missing.filter((f) => !f.downloadable);
  if (auto.length) {
    add(issues, {
      key: "pack-files", kind: "packFiles", severity: "error",
      title: auto.length === 1 ? "1 file of the pack is missing" : `${auto.length} files of the pack are missing`,
      detail: auto.map((f) => f.name).join(", "), fixes: [fix("Download them again", { kind: "restorePackFiles" })], crash: false,
    });
  }
  if (byHand.length) {
    add(issues, {
      key: "pack-manual", kind: "packFiles", severity: "warning",
      title: byHand.length === 1 ? "1 pack file downloads only by hand" : `${byHand.length} pack files download only by hand`,
      detail: `Their authors block launchers: ${byHand.map((f) => f.name).join(", ")}. Download them from their pages into the instance's mods folder.`,
      fixes: [], crash: false,
    });
  }

  const a = analyze(log, reports);
  if (a.crashed) {
    const before = issues.filter((i) => i.crash).length;
    for (const f of a.findings) {
      switch (f.kind) {
        case "requires": add(issues, requirement(inst, idx, f.by, f.dep, f.wanted, f.present, true)); break;
        case "breaks": add(issues, conflict(idx, f.by, f.other, true)); break;
        case "culprit": add(issues, culprit(idx, f.id)); break;
        case "mixin": {
          const j = jars.find((j) => j.meta.mixins.includes(f.config));
          if (j) add(issues, culprit(idx, j.meta.id));
          break;
        }
        case "java":
          add(issues, {
            key: "java", kind: "java", severity: "error", title: `Something needs Java ${f.needs}`,
            detail: launch.customJava
              ? `The custom Java in settings is older than Java ${f.needs}.`
              : `A mod is built for Java ${f.needs}, newer than Minecraft ${inst.version} runs on. Get a build of it for this version.`,
            fixes: launch.customJava ? [fix("Use the Java the launcher picks", { kind: "autoJava" })] : [], crash: true,
          });
          break;
        case "outOfMemory": {
          const mb = Math.floor(Math.min(launch.ramMb + 2048, MAX_SUGGESTED_RAM_MB) / 512) * 512;
          add(issues, {
            key: "memory", kind: "memory", severity: "error", title: "The game ran out of memory", detail: `It had ${gb(launch.ramMb)}.`,
            fixes: mb > launch.ramMb ? [fix(`Give it ${gb(mb)}`, { kind: "setRam", mb })] : [], crash: true,
          });
          break;
        }
        case "heapReserve": {
          const mb = Math.floor(Math.max(launch.ramMb / 2, 2048) / 512) * 512;
          add(issues, {
            key: "memory", kind: "memory", severity: "error", title: "Java could not get the memory it was given",
            detail: `${gb(launch.ramMb)} is more than this computer can spare.`,
            fixes: mb < launch.ramMb ? [fix(`Lower it to ${gb(mb)}`, { kind: "setRam", mb })] : [], crash: true,
          });
          break;
        }
        case "driver":
          add(issues, {
            key: "driver", kind: "driver", severity: "error", title: "The graphics driver crashed",
            detail: "Update the GPU driver from the vendor's site. Shaders and some render mods make this more likely.", fixes: [], crash: true,
          });
          break;
      }
    }
    if (issues.filter((i) => i.crash).length === before) {
      add(issues, {
        key: "crash", kind: "crash", severity: "error", title: "The game crashed",
        detail: "The log does not point at a mod this plugin can fix. Check the console for the full error.", fixes: [], crash: true,
      });
    }
  }
  // Stable: crash first, then errors, then warnings, each in the order found.
  const rank = (/** @type {Issue} */ i) => (i.crash ? 0 : i.severity === "error" ? 1 : 2);
  issues.sort((x, y) => rank(x) - rank(y));
  return { crashed: a.crashed, cause: a.cause, issues, mods: jars.length };
}

/** The fix "Fix all" runs: the recommended one, unless it deletes a file. @param {Issue} i */
export const autoFix = (i) => (i.fixes[0] && i.fixes[0].action.kind !== "deleteMod" ? i.fixes[0] : null);

// ─── Fixes ─────────────────────────────────────────────────────────────────

/** Mod ids that differ from their catalog slug. */
const SLUGS = /** @type {Record<string, string>} */ ({
  fabric: "fabric-api",
  "cloth-config2": "cloth-config",
  owo: "owo-lib",
  yet_another_config_lib_v3: "yacl",
  "yet-another-config-lib": "yacl",
  "cardinal-components": "cardinal-components-api",
  forgeconfigapiport: "forge-config-api-port",
  puzzleslib: "puzzles-lib",
  kotlinforforge: "kotlin-for-forge",
  resourcefullib: "resourceful-lib",
  geckolib3: "geckolib",
});

const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const LOADER_NAME = /** @type {Record<string, string>} */ ({ vanilla: "minecraft", fabric: "fabric", quilt: "quilt", forge: "forge", neoforge: "neoforge", liteloader: "liteloader" });

/** The catalog project behind a mod id: the id is usually the slug; otherwise a search by it. @param {import("../packages/plugin-api").TN} tn @param {string} source @param {Instance} inst @param {string} modId */
export async function findProject(tn, source, inst, modId) {
  const loader = LOADER_NAME[inst.loader];
  const filter = { kind: /** @type {const} */ ("mod"), gameVersion: inst.version, loader };
  const slugs = [...new Set([SLUGS[modId], modId, modId.replaceAll("_", "-")].filter(Boolean))];
  for (const slug of slugs) {
    const versions = await tn.sources.versions(source, slug, filter).catch(() => []);
    if (versions.length) return slug;
  }
  const page = await tn.sources.search(source, { kind: "mod", query: modId.replace(/[_-]/g, " "), gameVersion: inst.version, loader, categories: [], sort: "", offset: 0, limit: 10 });
  const want = slugs.map(norm);
  const hit = page.hits.find((h) => want.includes(norm(h.slug)) || want.includes(norm(h.title)));
  if (!hit) throw new Error(`${modId} for Minecraft ${inst.version} is not on ${source}`);
  return hit.id;
}

/** Runs one fix; resolves with what changed, for people. @param {import("../packages/plugin-api").TN} tn @param {Instance} inst @param {string} source @param {Action} a */
export async function apply(tn, inst, source, a) {
  const id = inst.id;
  switch (a.kind) {
    case "disableMod":
      if (!a.file.endsWith(".jar")) return `${a.file} is already off`;
      await tn.content.setEnabled(id, "mod", a.file, false);
      return `Turned off ${a.file}`;
    case "deleteMod":
      await tn.content.delete(id, "mod", a.file);
      return `Deleted ${a.file}`;
    case "installMod": {
      if (PLATFORM_IDS.includes(a.id)) throw new Error(`${a.id} comes with the game, not as a mod`);
      const project = await findProject(tn, source, inst, a.id);
      await tn.content.install({ instance: id, source, kind: "mod", project });
      return `Installed ${a.id}`;
    }
    case "updateMod": {
      const known = await tn.content.identify(id, source, "mod");
      const found = known[a.file];
      if (!found) throw new Error(`${a.file} is not from ${source}, so there is nothing to update it from`);
      await tn.content.install({ instance: id, source, kind: "mod", project: found.project.id, replace: a.file });
      return `Updated ${found.project.title}`;
    }
    case "restorePackFiles": {
      const n = await tn.instances.restoreFiles(id);
      return n === 1 ? "Downloaded 1 pack file" : `Downloaded ${n} pack files`;
    }
    case "updateLoader":
      return tn.instances.change(id, { kind: "updateLoader" });
    case "setRam":
      return tn.instances.change(id, { kind: "setRam", mb: a.mb });
    case "autoJava":
      return tn.instances.change(id, { kind: "autoJava" });
  }
}
