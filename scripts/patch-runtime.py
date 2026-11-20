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
    text = patched

claim_routes = '''  const proxyClaimRequest = async (c, targetPath) => {
    const requestUrl = new URL(c.req.url);
    const path = targetPath || requestUrl.pathname;
    const target = "http://127.0.0.1:45212" + path + requestUrl.search;
    const init = { method: c.req.method, headers: {} };
    const contentType = c.req.header("content-type");
    if (contentType) init.headers["content-type"] = contentType;
    if (!["GET", "HEAD"].includes(c.req.method)) init.body = await c.req.arrayBuffer();
    try {
      const response = await fetch(target, init);
      const body = await response.arrayBuffer();
      const headers = {};
      const responseType = response.headers.get("content-type");
      if (responseType) headers["content-type"] = responseType;
      return c.body(body, response.status, headers);
    } catch (err) {
      return c.json({ ok: false, error: "claim server unavailable: " + String(err && err.message ? err.message : err) }, 503);
    }
  };
  app.all("/claim", (c) => proxyClaimRequest(c));
  app.all("/claim/*", (c) => proxyClaimRequest(c));
  app.get("/claims", (c) => proxyClaimRequest(c, "/claim"));
'''
needle = '  if (options2.staticRoot?.trim()) {'
old_routes = re.compile(
    r'  const proxyClaimRequest = async \(c, targetPath\) => \{[\s\S]*?app\.get\("/claims", \(c\) => proxyClaimRequest\(c, "/claim"\)\);\n'
)
if old_routes.search(text):
    text = old_routes.sub('', text, count=1)
if 'app.get("/claims"' not in text:
    if needle not in text:
        raise SystemExit("[ERROR] static route insertion point not found")
    text = text.replace(needle, claim_routes + needle, 1)
    server.write_text(text, encoding="utf-8")
    print("[OK] injected /claims and /claim proxy routes")

text = web.read_text(encoding="utf-8")
text = re.sub(r'\s*<script src="/zcode-claim-bridge\.js"></script>\s*', '\n  ', text, count=1)
text = re.sub(
    r'<script>(?:(?!</script>)[\s\S])*?zcode-claim-widget(?:(?!</script>)[\s\S])*?</script>\s*',
    '',
    text,
    count=1,
)
if "</body>" in text:
    inline = "<script>\n" + bridge.read_text(encoding="utf-8") + "</script>\n  "
    text = text.replace("</body>", inline + "</body>", 1)
    web.write_text(text, encoding="utf-8")
    print("[OK] injected claim bridge widget")
