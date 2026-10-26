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

export function activate() {}
