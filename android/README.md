# ZCode Mobile — Android app shell

Port of ZCode Desktop 3.18.2 to Android. Java/XML sources live only under `app/src/main/`.
Package `com.zcodemobile`, loopback bridge `127.0.0.1:45210`, OAuth scheme `zcode`.

## Structure

```
app/src/main/
├── AndroidManifest.xml              MAIN/LAUNCHER + zcode://oauth/callback, foreground dataSync service
├── java/com/zcodemobile/
│   ├── ZCodeConfig.java             app.env constants inlined (no BuildConfig/R dependencies)
│   ├── ui/
│   │   ├── MainActivity.java        WebView host, loading screen, back button, permissions, deep links
│   │   └── webview/
│   │       ├── WebViewHost.java     single WebView, load/reload/fallback status page
│   │       ├── WebViewFactory.java  hardware layer, JS bridge injection ("Android")
│   │       ├── WebSettingsFactory.java  desktop UA, DOM storage, loopback-friendly settings
│   │       ├── ZWebViewClient.java  origin guard, OAuth intercept, main-frame error -> fallback
│   │       ├── ZWebChromeClient.java console log + file chooser delegation
│   │       └── LocalAssetServer.java local fallback status HTML (backend has no web root yet)
│   ├── bridge/AndroidBridge.java    @JavascriptInterface: getToken/saveToken/getDeviceMid/
│   │                                openExternal/notifyReady/claimPlan/oauthStart
│   ├── core/
│   │   ├── CoreServerService.java   foreground service, wake lock, supervisor host
│   │   ├── CoreLauncher.java        orphan kill + install + ProcessBuilder launch
│   │   ├── CoreProcessSupervisor.java ready probe, log stream, crash restart w/ backoff
│   │   ├── CoreEnvironment.java     HOME/ZCODE_DATA_BASE_DIR/secret/PATH/TMPDIR, strips LD_*
│   │   ├── BackendHealthProbe.java  GET /health {"ok": true}
│   │   ├── CoreRuntimeState.java    backendUrl/lastError/restarting/readyGeneration
│   │   ├── CoreServiceLauncher.java ForegroundService start/stop
│   │   ├── ForegroundNotification.java dataSync channel + ongoing notification
│   │   └── WakeLockHolder.java      partial wake lock
│   ├── runtime/
│   │   ├── RuntimeManager.java      install + coreCommand() + applyEnvironment()
│   │   ├── CoreInstaller.java       assets/backend + assets/node -> filesDir, marker verification
│   │   └── RuntimePaths.java        path constants/getters
│   ├── install/
│   │   ├── EnvInstaller.java        OPTIONAL deferred Bionic prefix install (see below)
│   │   └── TarExtractor/TarHeader/TarPath.java  path-safe pure-Java tar/gz extraction
│   ├── oauth/
│   │   ├── OAuthManager.java        external browser + zcode:// deep link handling
│   │   ├── TokenStore.java          JWT in app-private SharedPreferences
│   │   ├── SecretStore.java         persisted random 32-byte hex (ZCODE_CREDENTIAL_SECRET)
│   │   └── DeviceId.java            stable "android-<uuid>" deviceMid
│   └── util/                        AssetUnpacker, FileModeUtil, Sha256, IoUtil,
│                                    AtomicFileWriter, ProcessUtils, PathSafety
└── res/                             icon, colors, styles, strings, network_security_config
```

## Launch flow

1. `MainActivity.onCreate` builds the WebView + loading splash, requests
   POST_NOTIFICATIONS (API 33+) / storage (API <= 28), then starts
   `CoreServerService` via `startForegroundService`.
2. Service holds a partial wake lock + dataSync foreground notification and starts
   `CoreProcessSupervisor` on a worker thread.
3. Supervisor calls `CoreLauncher.launch`: kills orphan `backend/bootstrap.js`
   processes, installs `assets/backend` and `assets/node` into `filesDir`
   (marker based on app version + package update time, regenerable dirs only),
   then executes the **Bionic** Node binary directly — no glibc loader:

   ```
   <filesDir>/node/bin/node <filesDir>/backend/bootstrap.js
   ```

   Environment: `HOME`=filesDir, `ZCODE_DATA_BASE_DIR`=filesDir,
   `ZCODE_CREDENTIAL_SECRET`=persisted 64-char hex, `PATH`=filesDir/usr/bin:/system/bin,
   `TMPDIR`=cacheDir, `LD_PRELOAD`/`LD_LIBRARY_PATH` removed.
4. Env prefix install (Termux-style bootstrap from `env/build.sh`) is scheduled
   on a daemon thread 3.5s later and is **non-fatal** — Node/Bionic does not need it.
5. Supervisor polls `GET /health` until `{"ok":true}` (60s), publishes
   `CoreRuntimeState.backendUrl`, then publishes ready generation. It restarts the
   process on crash with exponential backoff (max 3, budget refills after 60s uptime).
6. MainActivity's poll loads `http://127.0.0.1:45210/` into the WebView once ready.
   If the backend has no web root (current bootstrap serves only `/health`, `/rpc`
   and the WebSocket upgrade), the main-frame 404/error triggers a local status
   page injected via `loadDataWithBaseURL`, which polls `/health` live and calls
   `Android.notifyReady()` to dismiss the splash.
7. `AndroidBridge` is injected as `window.Android`. OAuth is delegated to the
   system browser; `zcode://oauth/callback?token=...` returns through the
   MAIN/LAUNCHER activity's intent filter, stores the JWT in prefs and reloads.

## Adapted vs stubbed

- **Adapted** from the reference Antigravity-Mobile sources: foreground-service
  lifecycle, supervisor/restart policy, health-ready pattern, Bionic env tar
  extraction, asset unpacking, chmod/marker verification, WebView client/settings,
  OAuth browser handoff and deep-link structure.
- **New**: Node-specific launch path (no glibc loader), `ZCodeConfig`, JS bridge
  methods, `/health` probe, credential secret/deviceMid persistence, local fallback
  status page.
- **Stubbed / placeholder**:
  - `AndroidBridge.claimPlan(planId, callback)` POSTs JSON to
    `http://127.0.0.1:45210/claim` and invokes a JS callback with
    `{"ok":...,"result"|"error":...}`. The endpoint is not implemented by the
    current backend agent (no `claim/` files yet); adapter point is
    `AndroidBridge.callClaimEndpoint`.
  - `LocalAssetServer.intercept()` is a no-op hook; real UI is expected from the
    backend web root when available.
  - Bionic env prefix install is optional/deferred and unverified at runtime.
- No `R.*` / `BuildConfig.*` references in Java; the builder's generated
  `R.java`/`BuildConfig.java` remain unused by this code.

## Verification

- `javac -source 8 -target 8 -cp tools/android.jar -d <tmp> $(find app/src/main/java -name '*.java')`
  — passes (only the standard `-source 8`/deprecation warnings).
- All XML files parse as well-formed XML. `aapt package` could not be executed in
  this environment (bundled SDK `aapt` is x86-64, Termux `aapt2` fails to link);
  the builder's aapt invocations use `--auto-add-overlay` for both resource dirs.
