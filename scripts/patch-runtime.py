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
