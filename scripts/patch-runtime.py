#!/usr/bin/env python3
"""Patch a built ZCode runtime for Termux.

Usage: patch-runtime.py <runtime-root>

- server/entry-http.js: force projectStorageHostId to "local" and inject the
  /claims reverse proxy to the local claim service (127.0.0.1:45212).
- web/index.html: drop legacy claim-widget injections and add the
  startup-ready fallback that removes the static loading logo.
"""
import pathlib
import re
import sys

if len(sys.argv) < 2:
    raise SystemExit("usage: patch-runtime.py <runtime-root>")

root = pathlib.Path(sys.argv[1]).resolve()
server = root / "server" / "entry-http.js"
web = root / "web" / "index.html"

for item in (server, web):
    if not item.is_file():
        raise SystemExit(f"[ERROR] missing {item}")

PROXY_MARKER = "/* zcode-claim-proxy */"
PROXY_NEEDLE = "const app = new Hono();"
PROXY_BLOCK = """

  /* zcode-claim-proxy */
  const zcodeClaimOrigin = process.env["ZCODE_CLAIM_ORIGIN"]?.trim() || "http://127.0.0.1:45212";
  const zcodeClaimProxy = async (c) => {
    const incoming = new URL(c.req.url);
    let targetPath = incoming.pathname;
    if (targetPath === "/claims") targetPath = "/claim";
    else if (targetPath.startsWith("/claims/")) targetPath = "/claim/" + targetPath.slice(8);
    const target = new URL(targetPath + incoming.search, zcodeClaimOrigin);
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    const init = { method: c.req.method, headers, redirect: "manual" };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") init.body = await c.req.raw.arrayBuffer();
    try {
      const upstream = await fetch(target, init);
      const out = new Headers(upstream.headers);
      out.delete("content-encoding");
      out.delete("content-length");
      out.delete("transfer-encoding");
      return c.body(await upstream.arrayBuffer(), upstream.status, Object.fromEntries(out));
    } catch (error) {
      return c.json({ ok: false, error: String(error?.message || error) }, 502);
    }
  };
  app.all("/claims", (c) => zcodeClaimProxy(c));
  app.all("/claims/*", (c) => zcodeClaimProxy(c));
  app.all("/claim", (c) => zcodeClaimProxy(c));
  app.all("/claim/*", (c) => zcodeClaimProxy(c));"""

STARTUP_MARKER = "zcode-react-startup-ready"
STARTUP_SCRIPT = """<script>
      (() => {
        let done = false;
        const markReady = () => {
          if (done) return;
          done = true;
          document.body.classList.add("zcode-startup-ready");
          const loading = document.getElementById("loading");
          if (loading) window.setTimeout(() => loading.remove(), 500);
        };
        window.addEventListener("zcode-react-startup-ready", markReady, { once: true });
        const logo = document.querySelector(".startup-logo-shell");
        if (logo) logo.addEventListener("animationend", markReady, { once: true });
        window.setTimeout(markReady, 3000);
      })();
    </script>
  """

# --- server/entry-http.js ---
original = server.read_text(encoding="utf-8")
text = original

patched = re.sub(r"(?<!\?\.)projectStorageHostId\s*,\s*", 'projectStorageHostId: "local",', text, count=1)
if patched != text:
    text = patched
    print("[OK] patched projectStorageHostId")

if PROXY_MARKER in text:
    print("[OK] claim proxy already present")
elif PROXY_NEEDLE in text:
    text = text.replace(PROXY_NEEDLE, PROXY_NEEDLE + PROXY_BLOCK, 1)
    print("[OK] injected claim proxy")
else:
    raise SystemExit("[ERROR] Hono app factory not found in server/entry-http.js")

if text != original:
    server.write_text(text, encoding="utf-8")

# --- web/index.html ---
original = web.read_text(encoding="utf-8")
text = original

# strip legacy claim bridge/widget injections from older builds (idempotent)
text = re.sub(r'\s*<script src="/zcode-claim-bridge\.js"></script>\s*', "\n  ", text, count=1)
text = re.sub(r"<script>[\s\S]*?zcode-claim-widget[\s\S]*?</script>\s*", "", text, count=1)

if STARTUP_MARKER in text:
    print("[OK] startup fallback already present")
elif "</body>" in text:
    text = text.replace("</body>", STARTUP_SCRIPT + "</body>", 1)
    print("[OK] injected startup fallback")
else:
    raise SystemExit("[ERROR] </body> not found in web/index.html")

if text != original:
    web.write_text(text, encoding="utf-8")
