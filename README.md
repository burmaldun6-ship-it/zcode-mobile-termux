# ZCode Mobile (Termux Web Client)

Run the official ZCode v3.18.2 web UI and agent inside Termux on Android.
The agent's Bash tool executes commands in **Termux bash**, so it has direct
access to the Termux filesystem and packages.

## Status

- UI: official `@zcode/web` build (same React UI as the desktop client), responsive on phones.
- Server: official `@zcode/server` (`entry-http.js`), token-protected HTTP + `/ws`.
- Agent: official `zcode.cjs` agent bundle, spawned with `app-server --stdio`.
- Shell: `SHELL`/`PATH` point to Termux, so agent Bash commands run via `/data/data/com.termux/files/usr/bin/bash -c -l`.
- Giveaways: local claim page (see `claim/`), talks to the same ZCode endpoints as the desktop widget.
  The JWT is picked up automatically from the official web session — no manual copy/paste needed.
  A widget embedded in the web page shows detection status and sends the token to the local claim server.

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

The installer downloads the latest public release tarball via the GitHub API,
extracts it to `~/zcode-mobile-termux` and runs `install.sh` for you.

Or manually:

1. Download `zcode-mobile-termux-*.tar.gz` from the Releases page.
2. Extract it in Termux, for example:
   ```bash
   mkdir -p ~/zcode-mobile && tar -xzf zcode-mobile-termux-*.tar.gz -C ~/zcode-mobile --strip-components=1
   cd ~/zcode-mobile
   bash install.sh
   bash scripts/termux-official.sh
   ```

Open the printed URL, e.g. `http://127.0.0.1:3030/?token=<token>`.
From another device on the same Wi-Fi use the printed LAN URL.

After logging in once in the ZCode web tab, open the giveaway page
`http://127.0.0.1:45212/claim` (or `zcode claim`). The JWT is sent automatically
from the web session; use **Claim all**. A manual JWT field is kept as fallback.

Stop with `Ctrl+C`. The web token and credential secret are generated once and stored in `~/.zcode-mobile/`.

## Layout

- `dist/web/` — official web client (provided by the release tarball)
- `dist/server/` — official HTTP/WS server (provided by the release tarball)
- `dist/agent/zcode.cjs` — official agent bundle (provided by the release tarball)
- `dist/node_modules/` — runtime dependencies (provided by the release tarball)
- `scripts/termux-official.sh` — main launcher (web UI + agent + claim page)
- `scripts/termux-client.sh` — legacy Electron-bundle backend bridge (experimental; requires extracted AppImage assets)
- `scripts/claim-mini-server.js` — local giveaway/claim HTTP page
- `scripts/zcode-claim-bridge.js` — injected into the web UI to forward the logged-in JWT locally
- `scripts/patch-runtime.py` — applies the server/web patches to a built release
- `claim/` — claim/OAuth/marketing API implementation and tests
- `backend/`, `web/` — Node bootstrap and WebView shim for the legacy APK build
- `android/`, `builder/` — sources of the (experimental) Android APK build
- `tests/` — claim tests (`node tests/test-claim.js`, 16/16 mocked)

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
standalone server to treat projects as local and injects the JWT bridge.

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
