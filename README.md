# ZCode Mobile (Termux Web Client)

Run the official ZCode v3.18.2 web UI and agent inside Termux on Android.
The agent's Bash tool executes commands in **Termux bash**, so it has direct
access to the Termux filesystem and packages.

## Status

- UI: official `@zcode/web` build (same React UI as the desktop client), responsive on phones.
- Server: official `@zcode/server` (`entry-http.js`), token-protected HTTP + `/ws`.
- Agent: official `zcode.cjs` agent bundle, spawned with `app-server --stdio`.
- Shell: `SHELL`/`PATH` point to Termux, so agent Bash commands run via `/data/data/com.termux/files/usr/bin/bash -c -l`.
- Giveaways: local claim page (see `claim/`), served by the main server at
  `http://127.0.0.1:3030/claims` (`zcode claim`). It auto-detects the JWT from the
  logged-in web session (same origin — no copy/paste). Claims are gated behind the
  official Aliyun CAPTCHA SDK solved interactively by the user.

Real chat and claims require a ZCode/z.ai account. No credentials are bundled.

## Requirements

- Termux (Android, aarch64) with `node` >= 24 (`pkg install nodejs`), `bash`, `curl`, `iproute2`.
- ~600 MB free for data/workspace.
- A release tarball from GitHub Releases: no prebuilt binaries are stored in this repository.
  GitHub Actions builds them from upstream source in public, then publishes a **test** release.

## Quick start (one command)

```bash
curl -fsSL https://raw.githubusercontent.com/burmaldun6-ship-it/zcode-mobile-termux/main/install-remote.sh | bash
```

The installer resolves the newest release through the GitHub API (test builds are
published as pre-releases, which `/releases/latest` ignores), extracts it to
`~/zcode-mobile-termux`, runs `install.sh` for you and installs the `zcode` command.
Then run `zcode start` from the folder the agent should work in.

Or manually:

1. Download `zcode-mobile-termux-*.tar.gz` from the Releases page.
2. Extract it in Termux, for example:
   ```bash
   mkdir -p ~/zcode-mobile-termux && tar -xzf zcode-mobile-termux-*.tar.gz -C ~/zcode-mobile-termux --strip-components=1
   cd ~/zcode-mobile-termux
   bash install.sh
   cd ~/your-project        # the folder the agent should work in
   zcode start
   ```

Open the printed URL, e.g. `http://127.0.0.1:3030/?token=<token>`.
From another device on the same Wi-Fi use the printed LAN URL.

Log in to ZCode in the UI first. Then run `zcode claim`: it starts the claim service
and opens `http://127.0.0.1:3030/claims`, which picks up the JWT from the same browser
session automatically (or paste it manually under "Manual JWT"). Press **Claim all**:
if the campaign requires verification, the official Aliyun CAPTCHA window opens — solve
it yourself; no claim is sent before that.

Stop with `zcode stop`. The web token and credential secret are generated once and stored in `~/.zcode-mobile/`.

### Logs

Logs are written to `~/.zcode-mobile/logs/`:

- `official-server.log` — web server and agent (`zcode log`)
- `claim.log` — local claim mini server (`zcode claim-log`)
- `claim-trace.log` — every upstream claim/touch/config HTTP request and response, with
  redacted JWT/captcha values (`tail -f ~/.zcode-mobile/logs/claim-trace.log`).
  Enabled by default (`ZCODE_CLAIM_TRACE=1`); set `ZCODE_CLAIM_TRACE=0` to disable.

## Layout

- `dist/web/` — official web client (provided by the release tarball)
- `dist/server/` — official HTTP/WS server (provided by the release tarball)
- `dist/agent/zcode.cjs` — official agent bundle (provided by the release tarball)
- `dist/node_modules/` — runtime dependencies (provided by the release tarball)
- `scripts/zcode` — the `zcode` CLI wrapper (installed to `$PREFIX/bin/zcode`)
- `scripts/termux-official.sh` — workspace-aware launcher used by the wrapper
- `scripts/termux-client.sh` — legacy Electron-bundle backend bridge (experimental; requires extracted AppImage assets)
- `scripts/claim-mini-server.js` — local giveaway/claim HTTP page (auto-detects the JWT)
- `scripts/patch-runtime.py` — applies the server/web patches to a built release
- `claim/` — claim/OAuth/marketing API implementation and tests (`node claim/test-claim.js`, 16/16 mocked)
- `backend/`, `web/` — legacy Node bootstrap and WebView shim (experimental; not used by the Termux CLI)

## Building from source

`.github/workflows/build-release.yml` checks out upstream `zai-org/ZCode` v3.18.2,
installs dependencies with pnpm 10.33.2, runs `pnpm build:zcode`, assembles a tarball
with this repository's scripts plus the upstream `web/`, `server/`, `agent/` and
`node_modules/`, and publishes it as a prerelease ("test version").

Manual equivalent on a Linux host:

```bash
cd upstream
npm i -g pnpm@10.33.2
pnpm install --frozen-lockfile
pnpm build:zcode --base-url http://localhost/
UPSTREAM_VERSION=$(node -p "require('./package.json').version")
mkdir -p unpacked
tar -xzf "dist/zcode/releases/${UPSTREAM_VERSION}/zcode-${UPSTREAM_VERSION}.tar.gz" -C unpacked
bash ../scripts/assemble-release.sh unpacked/zcode ../dist-release
```

`assemble-release.sh` also runs `scripts/patch-runtime.py`, which forces the
standalone server to treat projects as local, injects the `/claims` reverse proxy
to the local claim service, and adds the startup-screen fallback to `web/index.html`.

On Bionic/Termux, Vite/Rolldown native bindings may require building on a glibc host.

## Limitations

- The `/remote` mobile pairing page is present in the web build, but it requires the external
  ZCode relay and a running Desktop client. Use the responsive main UI on the phone instead.
- The integrated terminal (`node-pty`) uses a glibc addon and may need a glibc loader;
  the agent Bash tool uses `child_process` and works without it.
- Provider templates load, but a login is needed for `providerCount > 0` and agent calls.

## License

Apache License 2.0. Release tarballs contain artifacts built from upstream
ZCode v3.18.2 (`zai-org/ZCode`), Copyright 2026 Z.AI Co., Ltd, also Apache-2.0.
Full text: `LICENSE`. Upstream notices: `THIRD_PARTY_NOTICES.md`,
`THIRD_PARTY_LICENSE`. Not affiliated with Z.ai.
