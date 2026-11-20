#!/usr/bin/env python3
"""05_stage_assets.py - Stage runtime, web and env assets into build/staging/assets.

Layout expected by the Android app (see RuntimePaths / EnvInstaller):
    assets/backend/**              Node backend + bundles
    assets/node/**                 Bionic Node runtime (bin/node, lib/...)
    assets/web/**                  renderer web bundle (+ preload/ shims)
    assets/env/bootstrap/bootstrap.tar.gz
    assets/env/manifest.json
    assets/env/pkg/**, assets/env/overlay/**

The renderer bundle is copied from the sibling desktop build into the writable
assets/web/ directory (cp -a) when that directory is empty. The env bootstrap
archive is produced by `bash env/build.sh bootstrap`; when env/packages/ is
absent, installation of extra packages is deferred to runtime and does not
block the build.
"""
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
ASSETS_DIR = os.path.join(PROJECT_ROOT, "assets")
ENV_DIR = os.path.join(PROJECT_ROOT, "env")
BUILD_DIR = os.path.join(PROJECT_ROOT, "build")
RENDERER_DIR = os.environ.get(
    "RENDERER_DIR", os.path.join(PROJECT_ROOT, "extracted", "app", "out", "renderer")
)
PRELOAD_DIR = os.environ.get(
    "PRELOAD_DIR", os.path.join(PROJECT_ROOT, "extracted", "app", "out", "preload")
)


def warn(msg):
    print(f"[WARN] [05] {msg}", file=sys.stderr)


def run(cmd, **kwargs):
    print(f"[*] [05] running: {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, **kwargs)


def copy_tree(src, dst, label):
    """Copy src/. into dst/ using cp -a (preserves symlinks and modes)."""
    if not os.path.isdir(src):
        raise RuntimeError(f"{label} source directory not found: {src}")
    os.makedirs(dst, exist_ok=True)
    run(["cp", "-a", os.path.join(src, "."), dst])
    print(f"[OK] [05] staged {label}: {src} -> {dst}")


def ensure_web_assets():
    """Populate assets/web from the renderer bundle when it is empty."""
    web_dir = os.path.join(ASSETS_DIR, "web")
    os.makedirs(web_dir, exist_ok=True)
    has_index = os.path.isfile(os.path.join(web_dir, "index.html"))
    if not has_index:
        if os.path.isfile(os.path.join(RENDERER_DIR, "index.html")):
            print(f"[*] [05] copying renderer bundle -> {web_dir} (cp -a)")
            run(["cp", "-a", os.path.join(RENDERER_DIR, "."), web_dir])
        else:
            warn(f"renderer bundle not found at {RENDERER_DIR}; assets/web stays empty")

    preload_src = os.path.join(PRELOAD_DIR, ".")
    preload_dst = os.path.join(web_dir, "preload")
    if os.path.isdir(PRELOAD_DIR) and os.listdir(PRELOAD_DIR):
        if not os.path.isdir(preload_dst) or not os.listdir(preload_dst):
            os.makedirs(preload_dst, exist_ok=True)
            print(f"[*] [05] copying preload shims -> {preload_dst} (cp -a)")
            run(["cp", "-a", preload_src, preload_dst])
    return web_dir


def ensure_bootstrap():
    """Build env/bootstrap/bootstrap.tar.gz via env/build.sh when missing."""
    tar = os.path.join(ENV_DIR, "bootstrap", "bootstrap.tar.gz")
    if os.path.isfile(tar) and os.path.getsize(tar) > 0:
        print(f"[*] [05] bootstrap archive already present: {tar}")
        return True
    build_sh = os.path.join(ENV_DIR, "build.sh")
    try:
        run(["bash", build_sh, "bootstrap"], cwd=ENV_DIR)
    except subprocess.CalledProcessError as exc:
        warn(f"env/build.sh bootstrap failed (exit {exc.returncode}); "
             "env install will be deferred to runtime")
        return False
    if not os.path.isfile(tar):
        warn("bootstrap archive was not produced; env install deferred")
        return False
    return True


def stage_env(assets_dir):
    """Stage env/pkg, env/overlay, bootstrap.tar.gz and manifest.json."""
    build_sh = os.path.join(ENV_DIR, "build.sh")
    env_out = os.path.join(BUILD_DIR, "env_dist")
    if os.path.isdir(env_out):
        shutil.rmtree(env_out)
    try:
        env = dict(os.environ)
        env["ASSETS"] = env_out
        run(["bash", build_sh, "assets"], cwd=ENV_DIR, env=env)
    except subprocess.CalledProcessError as exc:
        warn(f"env/build.sh assets failed (exit {exc.returncode}); "
             "staging env bundle manually (package install deferred)")
        src = os.path.join(env_out, "env")
        os.makedirs(src, exist_ok=True)
        for name in ("pkg", "overlay"):
            p = os.path.join(ENV_DIR, name)
            if os.path.isdir(p) and not os.path.exists(os.path.join(src, name)):
                run(["cp", "-a", p, os.path.join(src, name)])
        bdir = os.path.join(src, "bootstrap")
        os.makedirs(bdir, exist_ok=True)
        tar = os.path.join(ENV_DIR, "bootstrap", "bootstrap.tar.gz")
        if os.path.isfile(tar):
            shutil.copy2(tar, os.path.join(bdir, "bootstrap.tar.gz"))
        if not os.path.isfile(os.path.join(src, "manifest.json")):
            with open(os.path.join(src, "manifest.json"), "w", encoding="utf-8") as f:
                f.write('{\n  "schema": 1,\n  "bundleId": "deferred-env-install",\n'
                        '  "seedPackages": [],\n  "deferred": true\n}\n')

    src = os.path.join(env_out, "env")
    dst = os.path.join(assets_dir, "env")
    if not os.path.isdir(src):
        warn("no env bundle produced; env install deferred to runtime")
        return
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    run(["cp", "-a", os.path.join(src, "."), dst])
    print(f"[OK] [05] staged env bundle -> {dst}")


def dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def stage_assets(staging_dir):
    assets_dir = os.path.join(staging_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    ensure_web_assets()
    ensure_bootstrap()

    for src_name in ("backend", "node", "web"):
        src = os.path.join(ASSETS_DIR, src_name)
        dst = os.path.join(assets_dir, src_name)
        if not os.path.isdir(src):
            if src_name in ("backend", "node"):
                raise RuntimeError(f"required asset directory missing: {src}")
            warn(f"optional asset directory missing: {src}")
            continue
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        copy_tree(src, dst, f"assets/{src_name}")

    stage_env(assets_dir)

    print("============================================================")
    for name in ("backend", "node", "web", "env"):
        p = os.path.join(assets_dir, name)
        if os.path.isdir(p):
            print(f"[05] staged assets/{name}: {dir_size(p) / (1024*1024):.1f} MiB")
    print(f"[OK] [05] all assets staged into {assets_dir}")
    return assets_dir


def main():
    staging_dir = os.path.join(BUILD_DIR, "staging")
    for arg in sys.argv[1:]:
        if arg.startswith("-"):
            continue
        staging_dir = arg
    stage_assets(staging_dir)


if __name__ == "__main__":
    main()
