# ZCode backend for Android

This directory contains the Node-side backend extracted from ZCode Desktop
3.18.2 (Electron). The Electron main process is replaced by `bootstrap.js`.

## Contents (populated by `scripts/setup-backend.sh`)

- `out/host/` — host bundle + chunks (`index.js`, `tasksStorageWorker.js`).
- `out/scheduler/` — cron scheduler bundle.
- `out/extension-host/` — extension host bundle.
- `out/preload/` — reference only (renderer agent owns the real preload).
- `node_modules/` — flat dependency tree from the extracted app, merged with the
  native arm64 addons from `app.asar.unpacked/node_modules/`.
- `glm/` — agent runtime (`zcode.cjs`) + bundled skills/plugins.
- `config/` — `default.json`, `provider/zcode-builtin.json`.
- `tools/` — arm64 `ripgrep/rg`, `bfs/bfs`, `ugrep/ugrep`.
- `apps/zcode-cli/packages/cli/dist/zcode.cjs` — copy of the agent entry. The
  host's command resolver searches upward from cwd for this path; it is what
  enables `supportsStorageStartup` (DB preparation) without forcing
  `ZCODE_AGENT_SERVER_COMMAND`.
- `shim-parentport.js`, `bootstrap.js` — our code.

The Node runtime is installed separately in `../node/bin/node` and `../node/lib`.

## Launch

```sh
# from an Android app / Termux
$NODE ../node/bin/node bootstrap.js
# HTTP bridge defaults to 127.0.0.1:45210 (ZCODE_BRIDGE_PORT / ZCODE_BRIDGE_HOST)
```

## Environment

| Variable | Purpose |
| --- | --- |
| `ZCODE_BRIDGE_PORT` / `ZCODE_BRIDGE_HOST` | bridge listen address (default `127.0.0.1:45210`) |
| `HOME`, `ZCODE_HOME` | data root; defaults to `$HOME/.zcode` |
| `ZCODE_DATA_BASE_DIR` | `<zcode-home>/v2` by default |
| `ZCODE_CREDENTIAL_SECRET` / `_FILE` | credential encryption secret (32-4096 bytes) |
| `ZCODE_ENV` | `production` by default |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | `config/provider/zcode-builtin.json` |
| `ZCODE_AGENT_SERVER_COMMAND` | optional override; **do not set** for normal startup (it disables storage preparation) |
| `ZCODE_AGENT_SERVER_ARGS_JSON` | optional args override used with the command above |
| `ZCODE_AGENT_SERVER_CWD` | workspace directory (defaults to `$PWD`) |
| `ZCODE_LIB_DIR` | override directory containing the copied `.so` libs (defaults to `../node/lib`) |
| `ZCODE_WORKSPACE` | workspace reported in `InitLocal` |
| `ZCODE_NODE_BIN` | override node executable |
| `LD_LIBRARY_PATH` | bootstrap adds `../node/lib` automatically |

## Agent runtime

The host's resolver finds `apps/zcode-cli/packages/cli/dist/zcode.cjs` and spawns:

```
<node> <backend>/apps/zcode-cli/packages/cli/dist/zcode.cjs app-server --stdio
```

Storage preparation runs the same file in a `worker_threads.Worker`. Native addons
(`@napi-rs/keyring`, `node-pty`, `sharp`, `ssh2`, `koffi`) are arm64 **glibc**;
run under the provided glibc loader when the host requires them.

## Known limitations

- Host is forked with a fake `process.parentPort`; complex host->main port
  transfer and task-realtime bridge are not implemented.
- Credential cipher / key-share / media-preview requests to "main" return
  failure results; supply `ZCODE_CREDENTIAL_SECRET` for local credential use.
- UtilityProcess, BrowserWindow, dialog, shell, auto-update and CUA are stubbed.
- Extension host receives only `extension-host/init` (no `attach-window`).
- Renderer must speak the binary service-port protocol (see `PROTOCOL.md`).

## Deployment note

The APK extraction step must set the executable bit on
`assets/node/bin/node` and on `tools/{ripgrep/rg,bfs/bfs,ugrep/ugrep}`
(`chmod 755 ...`). The setup script attempts this, but the shared-storage
(`/storage/emulated`) FUSE mount ignores it; app-private `filesDir` does not.

## Verification

```sh
node --check bootstrap.js
node --check shim-parentport.js
../scripts/check-node.sh
```
