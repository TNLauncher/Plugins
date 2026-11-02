// @ts-check
// mclo.gs uploads. Everything runs in the instance tab; the background frame has nothing to do.
/** @typedef {import("../packages/plugin-api").TN} TN */

/** mclo.gs keeps at most this many lines. */
export const MAX_LINES = 25_000;

/** The last `max` lines: the end of a log is where it broke. @param {string} text */
export function tail(text, max = MAX_LINES) {
  const lines = text.split("\n");
  return lines.length > max ? lines.slice(-max).join("\n") : text;
}

/** Uploads `text`; resolves with the page URL. @param {TN} tn @param {string} text */
export async function upload(tn, text) {
  const res = await tn.net.fetch("https://api.mclo.gs/1/log", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `content=${encodeURIComponent(tail(text))}`,
  });
  const out = /** @type {{ success: boolean; url?: string; error?: string }} */ (res.json());
  if (!out.success || !out.url) throw new Error(out.error || `mclo.gs answered HTTP ${res.status}`);
  return out.url;
}

/** @typedef {"error" | "warn" | "info"} Level */

const ERROR = /[[/](ERROR|FATAL|SEVERE)\]|^(\S+\.)?\S*(Exception|Error)(:|$)/;
const WARN = /[[/]WARN(ING)?\]/;
/** Stack frames and `Caused by` lines belong to the line they follow. */
const CONTINUES = /^\s+at |^\s*\.\.\. \d+ more|^Caused by: |^\s+Suppressed: /;

/** Each line with its level; a stack trace takes the level of the line that threw it. @param {string} text */
export function classify(text) {
  /** @type {Level} */
  let last = "info";
  return text.split("\n").map((line) => {
    /** @type {Level} */
    const level = CONTINUES.test(line) ? last : ERROR.test(line) ? "error" : WARN.test(line) ? "warn" : "info";
    last = level;
    return { line, level };
  });
}

export function activate() {}
