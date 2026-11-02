// @ts-check
// Horizon (github.com/horizon-rust/horizon), Minecraft: Java Edition rewritten in Rust, as a TNLauncher game runtime.
// Follows Horizon's Launch API (docs/api/launch.md): horizon-prepare builds the game's resources from the player's
// own Minecraft files, then horizon-client starts with the account on stdin.
/** @typedef {import("../packages/plugin-api").TN} TN */
/** @typedef {import("../packages/plugin-api").Runtime} Runtime */
/** @typedef {import("../packages/plugin-api").RuntimeContext} RuntimeContext */

const RELEASES = "https://api.github.com/repos/horizon-rust/horizon/releases?per_page=50";
/** Game releases are named "Nightly 2026-11-01 · c9d474d"; the launcher's own are "Horizon launcher 0.2.36". */
const NIGHTLY = /^Nightly (\d{4}-\d{2}-\d{2}) · ([0-9a-f]{7,40})$/;
// shortcut: every build so far pins 26.3; read research-lock.json at the build's commit once one pins another version.
const MINECRAFT = "26.3";

/**
 * @typedef {{ name: string; browser_download_url: string; digest?: string | null }} Asset
 * @typedef {{ name: string; tag_name: string; assets: Asset[] }} Release
 */

/**
 * The archive Horizon publishes for a platform; its top folder has the same name.
 * @param {string} os
 * @param {string} arch
 */
export function platform(os, arch) {
  /** @type {Record<string, string | undefined>} */
  const names = { "linux x86_64": "horizon-linux-x86_64", "macos aarch64": "horizon-macos-arm64", "macos x86_64": "horizon-macos-x64", "windows x86_64": "horizon-windows-x64" };
  const name = names[`${os} ${arch}`];
  if (!name) throw new Error(`Horizon has no build for ${os} ${arch}`);
  return { folder: name, archive: os === "linux" ? `${name}.tar.gz` : `${name}.zip`, exe: os === "windows" ? ".exe" : "" };
}

/**
 * Game builds among GitHub releases, newest first, one per build (the moving `nightly` tag repeats a dated one at times).
 * @param {Release[]} releases
 */
export function builds(releases) {
  /** @type {Map<string, Release>} */
  const out = new Map();
  for (const r of releases) {
    const m = NIGHTLY.exec(r.name ?? "");
    if (m && !out.has(`${m[1]}-${m[2]}`)) out.set(`${m[1]}-${m[2]}`, r);
  }
  return [...out].map(([id, release]) => ({ id, release })).sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** @param {TN} tn */
async function releases(tn) {
  const res = await tn.net.fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return /** @type {Release[]} */ (res.json());
}

/**
 * The build's archive with its SHA-256, which GitHub keeps as `digest`.
 * @param {Release[]} list
 * @param {RuntimeContext} ctx
 */
export function files(list, ctx) {
  const build = builds(list).find((b) => b.id === ctx.version);
  if (!build) throw new Error(`Horizon ${ctx.version} is no longer on GitHub (nightlies are kept about a week). Create the instance again with a newer build.`);
  const { archive } = platform(ctx.os, ctx.arch);
  const asset = build.release.assets.find((a) => a.name === archive);
  const sha256 = asset?.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
  if (!asset || !sha256) throw new Error(`Horizon ${ctx.version} has no checked ${archive}`);
  return [{ url: asset.browser_download_url, filename: asset.name, sha256, extract: true }];
}

/**
 * Prepare when the resources are missing or were made by another preparer, then start the game.
 * @param {Parameters<Runtime["launch"]>[0]} ctx
 */
export function launch(ctx) {
  const { folder, exe } = platform(ctx.os, ctx.arch);
  const prepared = "${runtime}/prepared";
  return {
    serverJar: true,
    steps: [
      {
        title: "Preparing Horizon from your Minecraft",
        program: `${folder}/horizon-prepare${exe}`,
        check: ["--check", "--output", prepared],
        args: [
          "--prepare", "--complete", "--progress", "json", "--output", prepared,
          "--server-jar", "${mc.serverJar}", "--version-json", "${mc.versionJson}", "--client-jar", "${mc.clientJar}",
          "--libraries-dir", "${mc.libraries}", "--assets-dir", "${mc.assets}", "--java-home", "${javaHome}",
        ],
        progress: /** @type {const} */ ("json"),
      },
    ],
    game: {
      program: `${folder}/horizon-client${exe}`,
      args: [
        "--resources", prepared, "--game-dir", "${instance}", "--home", "${instance}",
        "--width", String(ctx.width), "--height", String(ctx.height),
        ...(ctx.fullscreen ? ["--fullscreen"] : []),
        ...(ctx.world ? ["--quickPlaySingleplayer", ctx.world] : []),
        "--session-stdin",
      ],
      session: /** @type {const} */ ("stdin"),
    },
  };
}

/** @param {TN} tn */
export function activate(tn) {
  tn.runtimes.register({
    versions: async () => builds(await releases(tn)).map((b) => ({ id: b.id, minecraft: MINECRAFT, stable: false })),
    install: async (ctx) => ({ files: files(await releases(tn), ctx) }),
    launch: async (ctx) => launch(ctx),
  });
}
