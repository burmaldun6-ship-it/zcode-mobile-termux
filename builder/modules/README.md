# ZCode Mobile APK builder (`modules/builder`)

No-Gradle builder that turns the Android project in `app/`, the runtime bundles
in `assets/`, and the renderer bundle into a signed, zip-aligned APK.

**One-command build (from the project root):**

```bash
bash build.sh --fast
# => dist/zcode-mobile.apk (signed with tools/debug.keystore, verified)
```

Drop `--fast` for compressed assets (smaller APK, slower build). Use
`--out PATH` to choose the output file and `--dev` for the dev package.

## Why aapt2

`aapt` (v1) from the SDK build-tools is an x86-64 binary and cannot run on this
arm64 host. All resource/manifest work therefore uses `aapt2`
(`/data/data/com.termux/files/usr/bin/aapt2`, version 16.0.0.4-4 / 2.20).

One aapt2 quirk matters: when linking compiled `.flat` inputs, aapt2 treats them
as overlays and requires `--auto-add-overlay` for resources not already present
in the base (e.g. `string/app_name`, `style/AppTheme`). Without it, link fails
with `resource ... does not override an existing resource`.

## Pipeline

| Phase | Script | What it does |
|-------|--------|--------------|
| 01 | `01_gen_config.py` | Reads `config/app.env`; writes `build/gen/.../BuildConfig.java`, a legacy `build/res/values/gen.xml` (not compiled), and the substituted `build/AndroidManifest.xml`. |
| 02 | `02_r_java.sh` | `aapt2 compile --dir app/src/main/res -o build/res/compiled.flata`, then `aapt2 link -o build/base.apk -I tools/android.jar --manifest build/AndroidManifest.xml -R compiled.flata --java build/gen --min-sdk-version 24 --target-sdk-version 28 --version-code 1 --version-name 3.18.2 --auto-add-overlay`. Produces `R.java` and a base APK holding the manifest + resource table. |
| 03 | `03_compile_java.sh` | `javac` over `app/src/main/java` + generated sources (argfile to avoid `ARG_MAX` overflow). |
| 04 | `04_dex.sh` | D8 (`tools/r8.jar`) -> `build/dex/classes.dex`. |
| 05 | `05_stage_assets.py` | Copies renderer bundle into writable `assets/web/`, builds `env/bootstrap/bootstrap.tar.gz` if missing, and stages `backend`, `node`, `web` and `env` into `build/staging/assets/`. |
| 06 | `06_package.sh` | Copies `build/base.apk`, appends `classes.dex` and the `assets/` tree. Already-compressed/binary files are stored, other files deflated; `--fast` stores everything. |
| 07 | `align.py` | 4-byte zipalign (system `zipalign`, pure-Python fallback). |
| 08 | `08_sign.sh` / `09_verify.sh` | `apksigner sign` with `tools/debug.keystore`, then `apksigner verify --verbose`. |

The app's Java code does not reference `R.*` (only `android.R`), so the aapt2-
generated `R.java` is harmless; it is kept for source compatibility.

## Asset contract

`RuntimePaths` / `CoreInstaller` / `EnvInstaller` expect these APK entries:

```
assets/backend/**                        576 MiB  (copied from assets/backend/)
assets/node/**                            95 MiB  (copied from assets/node/)
assets/web/**                             64 MiB  (renderer; + preload/ shims)
assets/env/bootstrap/bootstrap.tar.gz     59 MiB  (built by env/build.sh bootstrap)
assets/env/manifest.json
assets/env/pkg/**, assets/env/overlay/**
```

The renderer source defaults to `<repo>/extracted/app/out/renderer`
(override with `RENDERER_DIR`) and preload shims come from `out/preload`
(override with `PRELOAD_DIR`). `05_stage_assets.py` uses `cp -a` into
`assets/web/` only when `index.html` is absent, so the directory is idempotent.

**Optional env packages:** `env/packages/` is empty in this checkout. The
bootstrap archive is then built from `env/bootstrap/bootstrap-aarch64.zip` alone;
extra `.deb` installation is deferred to runtime and does not block the build.
If `env/build.sh assets` fails for any reason, staging falls back to copying
`env/pkg`, `env/overlay` and the bootstrap archive with a minimal manifest.

## Host toolchain

`python3` 3.14, `javac`/`java` 21, `aapt2` 16.0.0.4-4, `apksigner`, `zipalign`,
`node` 26. Jars/keystore live in `tools/` (`android.jar`, `r8.jar`,
`debug.keystore`). Paths are centralised in `config/paths.env`, which
`build_apk.sh` sources; legacy `com.agy` / `language_server` paths were removed.

## Tests

```bash
bash modules/builder/tests/run_all.sh
```
