# TNLauncher Plugins

Official and example plugins for [TNLauncher](https://github.com/TNLauncher/Launcher).

## Plugins

| Plugin | Kind | Description |
|---|---|---|
| [`modrinth`](./modrinth) | Content source | Mods, resource packs, shaders and `.mrpack` modpacks from Modrinth |
| [`curseforge`](./curseforge) | Content source | Mods, resource packs, shaders and modpacks from CurseForge |
| [`discord`](./discord) | Presence | Shows the running Minecraft version, loader and mod count in Discord Rich Presence |
| [`elyby`](./elyby) | Account provider | Ely.by accounts and skins through `authlib-injector` |
| [`offline`](./offline) | Account provider | Local profiles for singleplayer and offline-mode servers |
| [`mclogs`](./mclogs) | Instance tab | Uploads the game log or crash report to mclo.gs for a shareable link |
| [`export`](./export) | Instance tab | Exports an instance as a Modrinth `.mrpack` or a Prism/MultiMC zip |
| [`prism`](./prism) | Importer | Imports Prism Launcher and MultiMC instance zips |
| [`horizon`](./horizon) | Game runtime | Plays [Horizon](https://github.com/horizon-rust/horizon), Minecraft rewritten in Rust, from your own copy of Minecraft |
| [`examples/sessions`](./examples/sessions) | Page & instance tab | Example plugin that records play sessions |

## Installation

1. Open **Settings → Plugins → Open folder** in TNLauncher.
2. Copy the desired plugin folder (e.g. `modrinth`, `curseforge`, `discord`, `elyby`, `offline`) into the opened `plugins` directory.
3. Restart TNLauncher.

## Development

```sh
npm test                          # run unit tests
npx tsc -p tsconfig.json          # typecheck plugins against packages/plugin-api
node run.mjs <plugin> <method>    # run a plugin method against the live network
```
