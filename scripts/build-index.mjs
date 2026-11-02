// Packs every top-level plugin folder into dist/<id>-<version>.zip and writes dist/index.json, the store's catalog.
// The launcher installs a zip only if its SHA-256 matches the index and its manifest matches the entry.
//   node scripts/build-index.mjs [base url]   (default: the `registry` release of TNLauncher/Plugins)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const base = process.argv[2] ?? "https://github.com/TNLauncher/Plugins/releases/download/registry/";
const skip = new Set(["packages", "examples", "node_modules", "dist", "scripts"]);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
const plugins = [];
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith(".") || skip.has(dir.name)) continue;
  const folder = join(root, dir.name);
  if (!existsSync(join(folder, "manifest.json"))) continue;
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
  if (!/^[a-z0-9-]+$/.test(manifest.id ?? "")) throw new Error(`${dir.name}: bad id ${manifest.id}`);
  if (plugins.some((p) => p.manifest.id === manifest.id)) throw new Error(`${dir.name}: duplicate id ${manifest.id}`);
  if (!/^[A-Za-z0-9.+-]+$/.test(manifest.version ?? "")) throw new Error(`${dir.name}: bad version ${manifest.version}`);
  const file = `${manifest.id}-${manifest.version}.zip`;
  execFileSync("zip", ["-qrX", join(dist, file), ".", "-x", "*.test.js", "-x", ".*"], { cwd: folder });
  const bytes = readFileSync(join(dist, file));
  plugins.push({ manifest, url: base + file, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
}
writeFileSync(join(dist, "index.json"), JSON.stringify({ schema: 1, plugins }, null, 2) + "\n");
console.log(`${plugins.length} plugins → ${dist}`);
