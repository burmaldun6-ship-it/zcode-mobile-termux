#!/usr/bin/env python3
import pathlib
import re
import shutil
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
if "zcode-claim-bridge.js" not in text and "</head>" in text:
    text = text.replace("</head>", '<script src="/zcode-claim-bridge.js"></script>\n  </head>', 1)
    web.write_text(text, encoding="utf-8")
    print("[OK] injected claim bridge")

target = root / "web" / "zcode-claim-bridge.js"
if not target.exists() or target.read_bytes() != bridge.read_bytes():
    shutil.copyfile(bridge, target)
    print("[OK] installed claim bridge")
