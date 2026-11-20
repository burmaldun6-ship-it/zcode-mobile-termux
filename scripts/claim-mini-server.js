const http = require('http');
const path = require('path');
const BASE = path.join(__dirname, '..', 'claim');
const claim = require(path.join(BASE, 'claim.js'));
const claimServer = require(path.join(BASE, 'claim-server.js'));
const PORT = Number(process.env.CLAIM_PORT || 45212);

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode claim</title><style>
body{font:14px system-ui;background:#0f1115;color:#e8e8ea;margin:0;padding:20px;max-width:720px}
h1{font-size:20px;margin:0 0 12px}
.badge{display:inline-block;padding:6px 10px;border-radius:8px;background:#1b1e26;margin-bottom:12px}
.ok{color:#86efac}.wait{color:#fca5a5}
button{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:10px 14px;margin:4px 4px 4px 0;cursor:pointer}
details{margin:14px 0}summary{cursor:pointer;color:#a5b4fc}
textarea{width:100%;box-sizing:border-box;background:#1b1e26;color:#fff;border:1px solid #333;border-radius:8px;padding:10px;margin:8px 0}
pre{white-space:pre-wrap;background:#151821;padding:12px;border-radius:8px;overflow:auto;max-height:50vh}
</style></head><body><h1>ZCode giveaway claim</h1>
<div class="badge" id="badge">JWT: checking…</div>
<div><button onclick="claimAll()">Claim all</button><button onclick="campaigns()">Campaigns</button>
<button onclick="status()">Status</button></div>
<details><summary>Manual JWT (optional)</summary>
<textarea id="jwt" rows="3" placeholder="paste JWT if auto-detection fails"></textarea>
<button onclick="save()">Save JWT</button></details>
<pre id="out">Loading…</pre><script>
const out=document.getElementById('out');
const badge=document.getElementById('badge');
const jwt=document.getElementById('jwt');
function show(j){out.textContent=JSON.stringify(j,null,2)}
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));return r.json()}
function setBadge(ok){badge.className='badge '+(ok?'ok':'wait');badge.textContent=ok?'JWT: obtained automatically from ZCode web session':'JWT: not yet — log in to ZCode in the other tab'}
async function status(){const s=await api('/claim/status');setBadge(s.state.configured);show(s)}
async function campaigns(){show(await api('/claim/campaigns'))}
async function claimAll(){show(await api('/claim/claim-all',{method:'POST',body:'{}'}))}
async function save(){const token=jwt.value.trim();if(!token)return;show(await api('/claim/start',{method:'POST',body:JSON.stringify({jwt:token})}));status()}
setInterval(status,5000);status();
</script></body></html>`;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/claim' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (url.pathname === '/claim' && req.method === 'POST') {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      const state = claimServer.loadState();
      const token = body.jwt || body.token || state.jwt;
      if (!token) { send(res, 401, { ok: false, error: 'jwt required' }); return; }
      if (body.jwt || body.token) claimServer.saveState(Object.assign({}, state, { jwt: token }));
      const result = await claim.claimPlan({
        jwt: token,
        planId: body.planId || body.plan_id,
        platform: body.platform || state.platform,
        deviceMid: body.deviceMid || state.deviceMid,
        locale: body.locale || state.locale,
      });
      send(res, 200, Object.assign({ ok: !!result.success }, result));
    } catch (e) {
      send(res, 500, { ok: false, error: e.message });
    }
    return;
  }
  try {
    await claimServer.routeRequest(req, res);
  } catch (e) {
    if (!res.headersSent) send(res, 500, { ok: false, error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log('[claim] http://127.0.0.1:' + PORT + '/claim'));
