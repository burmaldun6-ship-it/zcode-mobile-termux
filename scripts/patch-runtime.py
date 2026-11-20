#!/usr/bin/env python3
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
scripts = pathlib.Path(__file__).resolve().parent
server = root / "server" / "entry-http.js"
web = root / "web" / "index.html"
bridge = scripts / "zcode-claim-bridge.js"

for item in (server, web, bridge):
    if not item.is_file():
        raise SystemExit(f"[ERROR] missing {item}")

text = server.read_text(encoding="utf-8")
patched = re.sub(r"(?<!\?\.)projectStorageHostId\s*,\s*", 'projectStorageHostId: "local",', text, count=1)
if patched != text:
    server.write_text(patched, encoding="utf-8")
    print("[OK] patched projectStorageHostId")

text = web.read_text(encoding="utf-8")
assets_dir = root / "web" / "assets"


def asset_exists(href):
    if not href or href.startswith(("http://", "https://", "data:")):
        return True
    rel = href[2:] if href.startswith("./") else href.lstrip("/")
    return (assets_dir / rel).is_file()


def normalize_entry(html):
    def replace(match):
        src = match.group(2)
        if asset_exists(src):
            return match.group(0)
        candidates = sorted(p.name for p in assets_dir.glob("index-*.js"))
        if not candidates:
            return match.group(0)
        new_src = "./assets/" + candidates[0]
        print(f"[OK] fixed stale web entry: {src} -> {new_src}")
        return match.group(1) + new_src + match.group(3)

    return re.sub(r'(<script[^>]*type="module"[^>]*src=")([^"]+)("[^>]*>)', replace, html, count=1)


def normalize_stylesheet(html):
    def replace(match):
        href = match.group(2)
        if asset_exists(href):
            return match.group(0)
        candidates = sorted(p.name for p in assets_dir.glob("index-*.css"))
        if not candidates:
            return match.group(0)
        new_href = "./assets/" + candidates[0]
        print(f"[OK] fixed stale web stylesheet: {href} -> {new_href}")
        return match.group(1) + new_href + match.group(3)

    return re.sub(r'(<link[^>]*rel="stylesheet"[^>]*href=")([^"]+)("[^>]*>)', replace, html, count=1)


def drop_missing_preloads(html):
    def replace(match):
        return match.group(0) if asset_exists(match.group(1)) else "\n  "

    return re.sub(r'\s*<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"[^>]*>\s*', replace, html)


text = normalize_entry(text)
text = normalize_stylesheet(text)
text = drop_missing_preloads(text)
# Remove legacy external bridge references.
text = re.sub(r'\s*<script src="/zcode-claim-bridge\.js"></script>\s*', '\n  ', text, count=1)
# Remove a previously injected inline bridge. The tempered pattern only matches
# inside ONE script block, so a re-run can never span across the app's own
# module/inline scripts the way a plain [\s\S]*? scan would.
text = re.sub(
    r'\s*<script>(?:(?!</script>)[\s\S])*?zcode-claim-widget(?:(?!</script>)[\s\S])*?</script>\s*',
    '\n  ',
    text,
    count=1,
)
if "</body>" in text:
    inline = "<script>\n" + bridge.read_text(encoding="utf-8") + "</script>\n  "
    text = text.replace("</body>", inline + "</body>", 1)
    web.write_text(text, encoding="utf-8")
    print("[OK] injected claim bridge widget")
