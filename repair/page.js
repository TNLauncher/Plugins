// @ts-check
// The Repair tab: the last crash, a file repair, and the problems found with their fixes.
import { apply, autoFix, diagnose } from "./doctor.js";
/** @typedef {import("../packages/plugin-api").TN} TN */
/** @typedef {import("../packages/plugin-api").RepairProgress} RepairProgress */
/** @typedef {import("../packages/plugin-api").RepairReport} RepairReport */
/** @typedef {import("./doctor.js").Issue} Issue */
/** @typedef {import("./doctor.js").Fix} Fix */

const tn = /** @type {TN} */ (/** @type {any} */ (window).tn);
const id = tn.context.instance ?? "";
const pane = /** @type {HTMLElement} */ (document.getElementById("pane"));

const STEPS = /** @type {const} */ ([
  ["game", "Game files"],
  ["pack", "Pack files"],
  ["mods", "Mod archives"],
]);
const ORDER = STEPS.map(([s]) => s);
const STAGE = { resolving: "Resolving version", java: "Downloading Java", loader: "Installing mod loader", libraries: "Libraries", assets: "Assets", starting: "Starting" };
const KIND_ICON = {
  missing: "extension_off", version: "swap_vert", game: "history", loader: "upgrade", conflict: "join_inner", duplicate: "content_copy",
  foreign: "block", broken: "broken_image", packFiles: "inventory_2", culprit: "bug_report", java: "coffee", memory: "memory", driver: "developer_board", crash: "error",
};

const state = {
  /** @type {import("../packages/plugin-api").Instance | null} */ inst: null,
  /** @type {ReturnType<typeof diagnose> | null} */ d: null,
  diagnosing: false,
  diagnoseError: "",
  /** @type {RepairProgress | null} */ progress: null,
  /** @type {RepairReport | null} */ report: null,
  repairError: "",
  /** @type {Record<string, { status: "busy" | "done" | "error"; message: string }>} */ fixes: {},
  fixingAll: false,
  /** @type {string[]} */ applied: [],
};

// ─── DOM ───────────────────────────────────────────────────────────────────

/** @param {string} tag @param {Record<string, any>} [attrs] @param {(Node | string | null | false | undefined)[]} kids */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const icon = (/** @type {string} */ name, fill = false, spin = false) => h("i", { class: `icon${fill ? " fill" : ""}${spin ? " spin" : ""}`, "aria-hidden": "true" }, name);
/** @param {{ label: string; icon?: string; variant?: string; size?: string; loading?: boolean; disabled?: boolean; title?: string; onclick?: () => void }} b */
const button = (b) =>
  h(
    "button",
    { type: "button", class: `btn ${b.variant ?? ""} ${b.size ?? ""}`, disabled: b.disabled || b.loading, title: b.title, onclick: b.onclick },
    b.loading ? icon("progress_activity", false, true) : b.icon ? icon(b.icon) : null,
    h("span", { class: "btn-label" }, b.label)
  );
const plural = (/** @type {number} */ n, /** @type {string} */ w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const errorText = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

// ─── Work ──────────────────────────────────────────────────────────────────

async function check() {
  if (state.diagnosing) return;
  state.diagnosing = true;
  state.diagnoseError = "";
  render();
  try {
    const inst = await tn.instances.get(id);
    // A source that is off or offline should not hide the rest of the check.
    const [mods, missing, log, reports, launch] = await Promise.all([
      tn.instances.mods(id),
      tn.instances.missingFiles(id).catch(() => []),
      tn.instances.readLog(id),
      tn.instances.crashReports(id),
      tn.instances.launchSettings(id),
    ]);
    state.inst = inst;
    state.d = diagnose({ instance: inst, mods, missing, log, reports, launch });
    state.fixes = {};
  } catch (e) {
    state.diagnoseError = errorText(e);
  }
  state.diagnosing = false;
  render();
}

async function source() {
  const chosen = (await tn.settings.get()).source;
  return state.inst?.pack?.source ?? (typeof chosen === "string" && chosen ? chosen : "modrinth");
}

/** @param {Issue} issue @param {Fix} f */
async function run(issue, f) {
  if (!state.inst) return false;
  state.fixes[issue.key] = { status: "busy", message: "" };
  renderProblems();
  try {
    const message = await apply(tn, state.inst, await source(), f.action);
    state.fixes[issue.key] = { status: "done", message };
    state.applied.push(message);
    return true;
  } catch (e) {
    state.fixes[issue.key] = { status: "error", message: errorText(e) };
    return false;
  } finally {
    renderProblems();
  }
}

/** Each open issue's recommended fix in order, then a fresh check: one fix often uncovers the next problem. */
async function fixAll() {
  if (!state.d || state.fixingAll) return;
  state.fixingAll = true;
  render();
  for (const issue of state.d.issues) {
    const f = autoFix(issue);
    if (f && state.fixes[issue.key]?.status !== "done") await run(issue, f);
  }
  state.fixingAll = false;
  await check();
}

async function repair() {
  if (state.progress) return;
  state.progress = { step: "game", stage: "resolving", done: 0, total: 0 };
  state.report = null;
  state.repairError = "";
  render();
  try {
    state.report = await tn.instances.repair(id);
  } catch (e) {
    state.repairError = errorText(e);
  }
  state.progress = null;
  render();
  // Restored files change what the check sees.
  await check();
}

// Assets report thousands of files: redraw the files card at most once per frame.
let frame = 0;
tn.events.on("repair-progress", (/** @type {{ instance: string; progress: RepairProgress }} */ p) => {
  if (p.instance !== id || !state.progress) return;
  state.progress = p.progress;
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    renderFiles();
  });
});
// A new session wrote a new log.
tn.events.on("game-exited", (/** @type {{ instanceId: string }} */ e) => e.instanceId === id && void check());

// ─── View ──────────────────────────────────────────────────────────────────

const slots = { crash: h("div"), files: h("div"), problems: h("div") };
pane.append(h("div", { class: "side" }, slots.crash, slots.files), slots.problems);

function render() {
  renderCrash();
  renderFiles();
  renderProblems();
}

function renderCrash() {
  const d = state.d;
  slots.crash.replaceChildren(
    d?.crashed
      ? h(
          "section",
          { class: "crash", "aria-label": "Last crash" },
          h("div", { class: "crash-head" }, icon("heart_broken", true), h("h3", {}, "The last session crashed")),
          d.cause ? h("code", { class: "cause" }, d.cause) : h("p", { class: "crash-text" }, "The log has no exception line. The launcher's Console has the full output.")
        )
      : ""
  );
}

/** @param {string} step */
function stepState(step) {
  const p = state.progress;
  if (p) {
    const at = ORDER.indexOf(p.step), me = ORDER.indexOf(/** @type {any} */ (step));
    return me < at ? "done" : me === at ? "active" : "idle";
  }
  return state.report ? "done" : "idle";
}

/** @param {string} step @param {RepairReport} r @returns {[string, string]} */
function stepResult(step, r) {
  if (step === "game") return r.gameFiles ? [`${plural(r.gameFiles, "file")} restored`, "fixed"] : ["All intact", ""];
  if (step === "pack") {
    if (!state.inst?.pack) return ["Not a modpack", ""];
    if (r.packError) return ["Could not check", "warn"];
    return r.packFiles ? [`${plural(r.packFiles, "file")} restored`, "fixed"] : ["All intact", ""];
  }
  if (r.broken.length) return [plural(r.broken.length, "damaged jar"), "warn"];
  return r.partials ? [`${plural(r.partials, "leftover")} cleared`, "fixed"] : ["All readable", ""];
}

function renderFiles() {
  const { progress: p, report: r } = state;
  const busy = !!p || state.fixingAll;
  slots.files.replaceChildren(
    h(
      "section",
      { class: "files", "aria-labelledby": "repair-files" },
      h(
        "div",
        { class: "files-head" },
        h("h3", { id: "repair-files" }, "Repair files"),
        h("p", {}, "Rehashes Minecraft, the loader, libraries, assets and the pack's own files. Damaged ones download again; your mods, worlds and settings stay as they are.")
      ),
      h(
        "ol",
        { class: "steps" },
        ...STEPS.map(([step, label]) => {
          const st = stepState(step);
          const live = st === "active" && p ? p : null;
          const known = !!live && live.total > 0;
          const result = st === "done" && !p && r ? stepResult(step, r) : null;
          return h(
            "li",
            { class: `step ${st}` },
            h("span", { class: "step-mark", "aria-hidden": "true" }, st === "done" ? icon("check") : st === "active" ? icon("progress_activity", false, true) : ""),
            h("span", { class: "step-text" }, h("b", {}, label), live && step === "game" && live.stage ? h("span", {}, STAGE[live.stage]) : null),
            known && live ? h("span", { class: "mono step-count" }, `${live.done.toLocaleString()} / ${live.total.toLocaleString()}`) : null,
            result ? h("span", { class: `step-result ${result[1]}` }, result[0]) : null,
            live
              ? h(
                  "div",
                  { class: `bar step-bar${known ? "" : " indeterminate"}`, role: "progressbar", "aria-valuenow": known ? Math.round((live.done / live.total) * 100) : null },
                  h("div", { class: "bar-fill", style: known ? `transform: scaleX(${live.done / live.total})` : null })
                )
              : null
          );
        })
      ),
      r?.packError ? h("p", { class: "note" }, `Pack files were skipped: ${r.packError}`) : null,
      r && r.broken.length ? h("p", { class: "note" }, `Not restorable, listed under Problems: ${r.broken.join(", ")}`) : null,
      state.repairError ? h("div", { class: "banner", role: "alert" }, h("span", {}, state.repairError)) : null,
      h(
        "div",
        { class: "files-foot" },
        button({ label: p ? "Repairing" : r ? "Repair again" : "Repair files", icon: "build", loading: !!p, disabled: busy, onclick: repair })
      )
    )
  );
}

/** Rows by issue key with what they were drawn from, so a redraw keeps unchanged rows and their animations. */
const rows = new Map();

/** @param {Issue} i @param {boolean} disabled */
function issueRow(i, disabled) {
  const fx = state.fixes[i.key];
  const sig = JSON.stringify([fx, disabled]);
  const cached = rows.get(i.key);
  if (cached && cached.sig === sig && cached.issue === i) return cached.el;
  const done = fx?.status === "done";
  const working = fx?.status === "busy";
  const [first, ...rest] = i.fixes;
  const el = h(
    "li",
    { class: `issue ${i.severity}${done ? " resolved" : ""}` },
    h("span", { class: "issue-mark", "aria-hidden": "true" }, icon(done ? "check_circle" : KIND_ICON[i.kind] ?? "error", done)),
    h(
      "div",
      { class: "issue-text" },
      h("div", { class: "issue-title" }, h("b", {}, i.title), i.crash && !done ? h("span", { class: "crash-tag" }, "Caused the crash") : null),
      h("p", {}, done ? fx.message : i.detail),
      fx?.status === "error" ? h("p", { class: "fix-error", role: "alert" }, icon("error"), fx.message) : null,
      !done && rest.length
        ? h(
            "div",
            { class: "alts" },
            "or",
            ...rest.map((f) => button({ label: f.label.charAt(0).toLowerCase() + f.label.slice(1), variant: "link", disabled: disabled || working, onclick: () => run(i, f) }))
          )
        : null
    ),
    !done && first
      ? h("div", { class: "fix-btn" }, button({ label: first.label, size: "sm", variant: i.crash ? "primary" : "", loading: working, disabled, title: first.label, onclick: () => run(i, first) }))
      : null
  );
  rows.set(i.key, { sig, issue: i, el });
  return el;
}

function renderProblems() {
  const d = state.d;
  const busy = !!state.progress || state.fixingAll;
  const open = d?.issues.filter((i) => state.fixes[i.key]?.status !== "done") ?? [];
  const fixable = open.filter((i) => autoFix(i));
  let body;
  if (state.diagnoseError) {
    body = h("div", { class: "banner", role: "alert" }, h("span", {}, state.diagnoseError), h("button", { type: "button", onclick: check }, icon("refresh"), "Retry"));
  } else if (!d) {
    body = h("div", { class: "list" }, ...[0, 1, 2].map(() => h("div", { class: "skeleton" })));
  } else if (!d.issues.length) {
    body = h(
      "div",
      { class: "clear" },
      h("span", { class: "clear-mark" }, icon("verified", true)),
      h("b", {}, "Nothing to fix"),
      h("span", {}, d.mods ? `${plural(d.mods, "mod")} checked: every requirement is met and nothing conflicts.` : "No mods to check, and the last session ended cleanly.")
    );
  } else {
    body = h("ul", { class: `list${state.diagnosing ? " stale" : ""}` }, ...d.issues.map((i) => issueRow(i, busy)));
  }
  slots.problems.replaceChildren(
    h(
      "section",
      { class: "problems", "aria-labelledby": "problems", "aria-busy": state.diagnosing ? "true" : null },
      h(
        "header",
        { class: "head" },
        h("h3", { id: "problems" }, "Problems"),
        open.length ? h("span", { class: "mono count" }, String(open.length)) : null,
        h(
          "div",
          { class: "head-actions" },
          fixable.length > 1 ? button({ label: "Fix all", icon: "auto_fix_high", size: "sm", variant: "primary", loading: state.fixingAll, disabled: !!state.progress, onclick: fixAll }) : null,
          h("button", { type: "button", class: "icon-btn", "aria-label": "Check again", title: "Check again", disabled: state.diagnosing || busy, onclick: check }, icon("refresh"))
        )
      ),
      state.applied.length ? h("p", { class: "applied" }, icon("check_circle", true), h("span", {}, state.applied.join(" · "))) : null,
      body
    )
  );
}

render();
void check();
