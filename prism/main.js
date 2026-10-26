// @ts-check
// Prism Launcher / MultiMC instance zips: `mmc-pack.json` lists the game and loader, `instance.cfg` the
// name, and the game folder (`.minecraft` or `minecraft`) is copied over as is. MultiMC wraps it all in a folder.
/** @typedef {import("../packages/plugin-api").TN} TN */
/** @typedef {import("../packages/plugin-api").PackPlan} PackPlan */

const LOADERS = /** @type {Record<string, string>} */ ({
  "net.fabricmc.fabric-loader": "fabric",
  "org.quiltmc.quilt-loader": "quilt",
  "net.minecraftforge": "forge",
  "net.neoforged": "neoforge",
  "com.mumfrey.liteloader": "liteloader",
});

/** @param {Record<string, string>} root @returns {PackPlan} */
export function plan(root) {
  const key = Object.keys(root).find((k) => k === "mmc-pack.json" || /^[^/]+\/mmc-pack\.json$/.test(k));
  if (!key) throw new Error("Not a Prism or MultiMC instance");
  const prefix = key.slice(0, -"mmc-pack.json".length);
  const components = /** @type {{ uid: string; version?: string; cachedVersion?: string }[]} */ (JSON.parse(root[key]).components ?? []);
  const version = (/** @type {string} */ uid) => {
    const c = components.find((c) => c.uid === uid);
    return c && (c.version || c.cachedVersion || "");
  };
  const gameVersion = version("net.minecraft");
  if (!gameVersion) throw new Error("This instance does not say which Minecraft it runs");
  const loaderUid = Object.keys(LOADERS).find((uid) => version(uid) !== undefined);
  const name = (root[`${prefix}instance.cfg`] ?? "").match(/^name=(.*)$/m)?.[1]?.trim() || prefix.slice(0, -1) || gameVersion;
  return {
    name,
    gameVersion,
    loader: loaderUid ? LOADERS[loaderUid] : "",
    loaderVersion: loaderUid ? /** @type {string} */ (version(loaderUid)) : "",
    files: [],
    overrides: [`${prefix}.minecraft`, `${prefix}minecraft`],
  };
}

/** @param {TN} tn */
export function activate(tn) {
  tn.importers.register({ plan: async (root) => plan(root) });
}
