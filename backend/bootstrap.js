'use strict';

// Node bootstrap replacing Electron's out/main/index.js for Android.
// Forks the three plain-Node bundles, shims process.parentPort, and exposes a
// small HTTP/WebSocket bridge for the Android WebView renderer.

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');

const BACKEND = __dirname;
const OUT = path.join(BACKEND, 'out');
const WEB_ROOT = path.join(BACKEND, '..', 'web');
const SHIM = path.join(BACKEND, 'shim-parentport.js');
let claimRoutes = null;
let claimLib = null;
let claimState = null;
try {
  const claimServer = require(path.join(BACKEND, '..', 'claim', 'claim-server.js'));
  claimRoutes = claimServer.routeRequest;
  claimState = claimServer;
} catch (_) {}
try { claimLib = require(path.join(BACKEND, '..', 'claim', 'claim.js')); } catch (_) {}
const PORT = Number(process.env.ZCODE_BRIDGE_PORT || 45210);
const HOST = process.env.ZCODE_BRIDGE_HOST || '127.0.0.1';

const CLAIM_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode Mobile — Claim</title>
<style>body{font:15px/1.5 sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:20px;max-width:760px}
h1{font-size:20px}textarea,button{font:inherit}textarea{width:100%;height:80px;background:#1b1f27;color:#eee;border:1px solid #333;border-radius:8px;padding:8px;box-sizing:border-box}
button{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:9px 14px;margin:8px 6px 8px 0;cursor:pointer}
pre{white-space:pre-wrap;word-break:break-all;background:#1b1f27;border-radius:8px;padding:12px;min-height:80px}
a{color:#a78bfa}</style></head><body>
<h1>ZCode Mobile — награды</h1>
<p>Вставьте zcode JWT (из zcode.z.ai), сохраните его, затем нажмите «Claim all».</p>
<textarea id="jwt" placeholder="zcodejwttoken"></textarea><br>
<button id="save">Save JWT</button><button id="campaigns">Campaigns</button>
<button id="claim">Claim all</button><button id="status">Status</button>
<a href="/">← Open app</a>
<pre id="out">loading...</pre>
<script>
var out = document.getElementById('out');
function show(x){ out.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2); }
async function api(path, opts){
  var r = await fetch(path, Object.assign({headers:{'Content-Type':'application/json'}}, opts || {}));
  return r.json();
}
document.getElementById('save').onclick = async function(){
  var jwt = document.getElementById('jwt').value.trim();
  if(!jwt){ show('enter JWT first'); return; }
  show(await api('/claim/start', {method:'POST', body:JSON.stringify({jwt:jwt})}));
};
document.getElementById('campaigns').onclick = async function(){ show(await api('/claim/campaigns')); };
document.getElementById('claim').onclick = async function(){
  show('claiming...');
  show(await api('/claim/claim-all', {method:'POST', body:'{}'}));
};
document.getElementById('status').onclick = async function(){ show(await api('/claim/status')); };
api('/claim/status').then(function(r){
  show(r);
  if(r && r.state && r.state.configured) show('JWT configured. Ready to claim.\\n' + JSON.stringify(r,null,2));
}).catch(show);
</script></body></html>`;

const HOME = process.env.HOME || process.env.TMPDIR || '/data/data/com.termux/files/home';
const ZCODE_HOME = process.env.ZCODE_HOME || path.join(HOME, '.zcode');
const DATA_BASE = process.env.ZCODE_DATA_BASE_DIR || path.join(ZCODE_HOME, 'v2');
const WORKSPACE = process.env.ZCODE_WORKSPACE || process.env.PWD || HOME;
const PROVIDER_CONFIG = process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ||
  path.join(BACKEND, 'config', 'provider', 'zcode-builtin.json');

function firstExisting(...paths) {
  for (const p of paths) {
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

const NODE_BIN = firstExisting(
  process.env.ZCODE_NODE_BIN,
  path.join(BACKEND, '..', 'node', 'bin', 'node'),
  process.execPath,
) || process.execPath;
const ZCODE_CJS = firstExisting(
  process.env.ZCODE_AGENT_ENTRY,
  path.join(BACKEND, 'glm', 'zcode.cjs'),
);

let SECRET = process.env.ZCODE_CREDENTIAL_SECRET || '';
if (!SECRET && process.env.ZCODE_CREDENTIAL_SECRET_FILE) {
  try { SECRET = fs.readFileSync(process.env.ZCODE_CREDENTIAL_SECRET_FILE, 'utf8').trim(); } catch (_) {}
}
if (!SECRET) {
  // Fallback stable-enough dev secret so credentials.json can still be opened.
  SECRET = crypto.createHash('sha256').update(`zcode-android:${ZCODE_HOME}`).digest('hex');
}

function resolveTool(rel) {
  return firstExisting(path.join(BACKEND, 'tools', rel), '') || '';
}

const LIB_DIR = process.env.ZCODE_LIB_DIR || path.join(BACKEND, '..', 'node', 'lib');

const COMMON_ENV = {
  ...process.env,
  HOME,
  ZCODE_HOME,
  ZCODE_DATA_BASE_DIR: DATA_BASE,
  ZCODE_CREDENTIAL_SECRET: SECRET,
  ZCODE_ENV: process.env.ZCODE_ENV || 'production',
  ZCODE_DESKTOP_HOME_DIR: BACKEND,
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: PROVIDER_CONFIG,
  // Do not force ZCODE_AGENT_SERVER_COMMAND: that bypasses Gp(), which is the
  // resolver that sets supportsStorageStartup and lets the host prepare its DB.
  ...(process.env.ZCODE_AGENT_SERVER_COMMAND ? { ZCODE_AGENT_SERVER_COMMAND: process.env.ZCODE_AGENT_SERVER_COMMAND } : {}),
  ...(process.env.ZCODE_AGENT_SERVER_ARGS_JSON ? { ZCODE_AGENT_SERVER_ARGS_JSON: process.env.ZCODE_AGENT_SERVER_ARGS_JSON } : {}),
  ZCODE_AGENT_SERVER_CWD: process.env.ZCODE_AGENT_SERVER_CWD || WORKSPACE,
  ZCODE_BFS_BINARY: process.env.ZCODE_BFS_BINARY || resolveTool('bfs/bfs'),
  ZCODE_UGREP_BINARY: process.env.ZCODE_UGREP_BINARY || resolveTool('ugrep/ugrep'),
  ZCODE_RIPGREP_BINARY: process.env.ZCODE_RIPGREP_BINARY || resolveTool('ripgrep/rg'),
  NODE_PATH: [path.join(BACKEND, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};

function withShim(extra) {
  const prev = process.env.NODE_OPTIONS || '';
  const need = `--require=${JSON.stringify(SHIM)}`;
  return {
    ...COMMON_ENV,
    ...extra,
    NODE_OPTIONS: [prev, need].filter(Boolean).join(' '),
  };
}

try { fs.mkdirSync(DATA_BASE, { recursive: true }); } catch (_) {}

// ---------------------------------------------------------------------------
// Bootstrap-side relay port (the "renderer service port").
// ---------------------------------------------------------------------------

class RelayPort extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.closed = false;
  }

  post(data, transfer) {
    if (this.closed) return;
    sendToChild('host', { __zcode: 1, t: 'portmsg', id: this.id, data, ports: portRefs(transfer) });
  }

  deliver(data, ports) {
    this.emit('frame', data, ports);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    sendToChild('host', { __zcode: 1, t: 'portclose', id: this.id });
    this.emit('close');
  }
}

function portRefs(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && typeof p.id === 'string').map((p) => ({ __zcodePort: p.id }));
}

const servicePort = new RelayPort(`renderer-${crypto.randomUUID()}`);

// ---------------------------------------------------------------------------
// Child process management.
// ---------------------------------------------------------------------------

const children = Object.create(null);
const stopping = { value: false };

function sendToChild(name, msg) {
  const c = children[name];
  if (c && c.connected) {
    try { c.send(msg); } catch (_) {}
  }
}

function spawnChild(name, relPath, envExtra, onSpawn) {
  const file = path.join(OUT, relPath);
  const child = fork(file, [], {
    execPath: NODE_BIN,
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    cwd: BACKEND,
    env: withShim({ ZCODE_PROCESS_LABEL: name, ...envExtra }),
  });
  children[name] = child;
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('message', (m) => onChildMessage(name, m));
  child.on('error', (e) => console.error(`[bootstrap] ${name} error:`, e.message));
  child.on('exit', (code, signal) => {
    if (children[name] === child) delete children[name];
    if (stopping.value) return;
    console.error(`[bootstrap] ${name} exited (code=${code} signal=${signal}); restarting in 1s`);
    setTimeout(() => {
      if (!stopping.value) {
        const next = spawnChild(name, relPath, envExtra, onSpawn);
        if (onSpawn) onSpawn(next);
      }
    }, 1000);
  });
  if (onSpawn) onSpawn(child);
  return child;
}

const state = {
  hostReady: false,
  startup: null,
  startedAt: Date.now(),
};

function sendInitLocal() {
  const msg = {
    type: 'init-local',
    databaseStartupId: crypto.randomUUID(),
    hostId: crypto.randomUUID(),
    deliveryKind: 'desktop_window',
    deviceMid: `android-${crypto.randomUUID().slice(0, 8)}`,
    workspacePath: WORKSPACE,
    workspaceIdentity: WORKSPACE,
    agentWarmupTargets: [{ workspacePath: WORKSPACE, workspaceIdentity: WORKSPACE }],
    agentSpawnFallbackCwd: WORKSPACE,
    zcodeBuiltinProviderConfigFilePath: PROVIDER_CONFIG,
    locale: 'en-US',
    remoteAssets: {},
    runtimeProcessEnvPatch: {},
  };
  state.databaseStartupId = msg.databaseStartupId;
  state.hostId = msg.hostId;
  state.deviceMid = msg.deviceMid;
  sendToChild('host', {
    __zcode: 1,
    t: 'parent',
    data: msg,
    ports: [{ __zcodePort: servicePort.id }],
  });
  console.log('[bootstrap] sent init-local to host');
}

function replyToHost(data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
  if (data.type === 'credential-cipher-result' || data.type === 'credential-key-share-result') return;
  if (data.type === 'credential-cipher-request') {
    sendToChild('host', {
      __zcode: 1, t: 'parent',
      data: {
        type: 'credential-cipher-result',
        requestId: data.requestId,
        result: { ok: false, error: { code: 'UNSUPPORTED_ON_ANDROID', message: 'Main-process credential cipher is not available in the Node bootstrap.' } },
      },
    });
    return;
  }
  if (data.type === 'credential-key-share-request') {
    sendToChild('host', {
      __zcode: 1, t: 'parent',
      data: {
        type: 'credential-key-share-result',
        requestId: data.requestId,
        ok: false,
        errorCode: 'CREDENTIAL_SECURE_STORAGE_UNAVAILABLE',
      },
    });
    return;
  }
  if (data.type === 'database-startup-state') {
    state.startup = data.state;
    if (data.state && data.state.phase === 'ready') state.hostReady = true;
    return;
  }
  if (data.type === 'local-media-preview-path-authorize-request') {
    sendToChild('host', {
      __zcode: 1, t: 'parent',
      data: { type: 'local-media-preview-path-authorize-result', requestId: data.requestId, ok: false, error: 'Media preview authorization is unavailable.' },
    });
    return;
  }
  // Log / agent-process / telemetry messages are informational.
  if (data.type === 'agent-process-error' || data.type === 'agent-process-exception') {
    console.error('[host]', data.type, data.error || data.diagnostic || '');
  }
}

function onChildMessage(name, m) {
  if (!m || typeof m !== 'object') return;
  if (m.__zcode === 1) {
    if (m.t === 'parent') {
      if (name === 'host') replyToHost(m.data);
      return;
    }
    if (m.t === 'portmsg') {
      if (name === 'host' && m.id === servicePort.id) servicePort.deliver(m.data, m.ports);
      return;
    }
    if (m.t === 'portclose') return;
  }
  if (name === 'extension-host' && m.type === 'extension-host/log') {
    console.log(`[ext] ${m.level}: ${m.message}`);
  }
}

// ---------------------------------------------------------------------------
// Binary RPC codec (VSBuffer / ChannelServer protocol) for /rpc.
// ---------------------------------------------------------------------------

function putInt(bytes, n) {
  let v = n >>> 0;
  if (v === 0) { bytes.push(0); return; }
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
}

function putBytes(bytes, arr) {
  for (let i = 0; i < arr.length; i++) bytes.push(arr[i] & 0xff);
}

function serializeValue(bytes, value) {
  if (value === undefined) { bytes.push(0); return; }
  if (typeof value === 'string') {
    bytes.push(1);
    const b = Buffer.from(value, 'utf8');
    putInt(bytes, b.length);
    putBytes(bytes, b);
    return;
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    bytes.push(2);
    putInt(bytes, value.length);
    putBytes(bytes, value);
    return;
  }
  if (Array.isArray(value)) {
    bytes.push(4);
    putInt(bytes, value.length);
    for (const item of value) serializeValue(bytes, item);
    return;
  }
  if (typeof value === 'number' && (value | 0) === value) {
    bytes.push(6);
    putInt(bytes, value);
    return;
  }
  const b = Buffer.from(JSON.stringify(value) || 'null', 'utf8');
  bytes.push(5);
  putInt(bytes, b.length);
  putBytes(bytes, b);
}

function makeReader(buf) {
  let pos = 0;
  const u8 = () => buf[pos++];
  const int = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = u8();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  };
  const take = (n) => {
    const out = buf.subarray(pos, pos + n);
    pos += n;
    return out;
  };
  const value = () => {
    const tag = u8();
    switch (tag) {
      case 0: return undefined;
      case 1: return Buffer.from(take(int())).toString('utf8');
      case 2: return take(int());
      case 3: return take(int());
      case 4: {
        const n = int();
        const out = [];
        for (let i = 0; i < n; i++) out.push(value());
        return out;
      }
      case 5: return JSON.parse(Buffer.from(take(int())).toString('utf8'));
      case 6: return int();
      default: throw new Error(`unknown rpc tag ${tag}`);
    }
  };
  return { value, remaining: () => pos < buf.length };
}

const rpcPending = new Map();
let rpcNextId = 1;

servicePort.on('frame', (data) => {
  if (!data || !(data instanceof Uint8Array) && !Buffer.isBuffer(data)) return;
  try {
    const r = makeReader(Buffer.from(data));
    const head = r.value();
    if (!Array.isArray(head)) return;
    const type = head[0];
    const id = head[1];
    if (type === 201 && rpcPending.has(id)) {
      const p = rpcPending.get(id);
      rpcPending.delete(id);
      p.resolve(r.remaining() ? r.value() : undefined);
    } else if ((type === 202 || type === 203 || type === 204 || type === 205) && rpcPending.has(id)) {
      const p = rpcPending.get(id);
      rpcPending.delete(id);
      p.reject(new Error(JSON.stringify(r.remaining() ? r.value() : null)));
    }
  } catch (e) {
    // Frames not belonging to /rpc are ignored.
  }
});

function rpcCall(channel, method, params) {
  return new Promise((resolve, reject) => {
    const id = rpcNextId++;
    const timer = setTimeout(() => {
      rpcPending.delete(id);
      reject(new Error('rpc timeout'));
    }, 30000);
    rpcPending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const bytes = [];
    serializeValue(bytes, [100, id, channel, method]);
    serializeValue(bytes, params === undefined ? null : params);
    servicePort.post(Uint8Array.from(bytes));
  });
}

const METHOD_MAP = {
  'zcode.ping': ['zcode', 'ping'],
  'zcode.getVersion': ['zcode', 'getVersion'],
};

function resolveMethod(method) {
  if (METHOD_MAP[method]) return METHOD_MAP[method];
  const parts = String(method).split('.');
  if (parts[0] === 'zcode' && parts.length >= 3) {
    return [parts[1], parts.slice(2).join('.')];
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket bridge.
// ---------------------------------------------------------------------------

let WebSocketServer = null;
try { WebSocketServer = require('ws').WebSocketServer; } catch (_) {
  try { WebSocketServer = require(path.join(BACKEND, 'node_modules', 'ws')).WebSocketServer; } catch (_) {}
}

const wsClients = new Set();
const wss = WebSocketServer ? new WebSocketServer({ noServer: true }) : null;

if (wss) {
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    servicePort.on('frame', onFrame);
    function onFrame(data) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(Buffer.from(data)); } catch (_) {}
      }
    }
    ws.on('message', (data, isBinary) => {
      try {
        const bytes = isBinary || Buffer.isBuffer(data) ? new Uint8Array(data) : new Uint8Array(Buffer.from(String(data), 'utf8'));
        servicePort.post(bytes);
      } catch (e) {
        try { ws.send(JSON.stringify({ error: e.message })); } catch (_) {}
      }
    });
    ws.on('close', () => {
      wsClients.delete(ws);
      servicePort.off('frame', onFrame);
    });
    ws.on('error', () => {});
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.webp': 'image/webp', '.pdf': 'application/pdf',
};

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(WEB_ROOT, '.' + rel);
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    if (ext === '.html') {
      let html = data.toString('utf8');
      if (pathname === '/' || pathname === '/index.html') {
        const tag = '<script src="/zcode-webview-shim.js"></script>';
        if (!html.includes('zcode-webview-shim.js')) {
          if (html.includes('</head>')) html = html.replace('</head>', tag + '</head>');
          else html = tag + html;
        }
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (url.pathname === '/claim' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(CLAIM_PAGE);
    return;
  }

  if (url.pathname === '/claim' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const state = claimState ? claimState.loadState() : {};
      const jwt = body.jwt || body.token || state.jwt || '';
      if (body.token && claimState) {
        claimState.saveState(Object.assign({}, state, { jwt: body.token }));
      }
      if (!jwt) { sendJson(res, 401, { ok: false, error: 'jwt required' }); return; }
      if (!claimLib) { sendJson(res, 501, { ok: false, error: 'claim module unavailable' }); return; }
      const result = await claimLib.claimPlan({
        jwt,
        planId: body.planId || body.plan_id,
        platform: body.platform || state.platform,
        deviceMid: body.deviceMid || state.deviceMid,
        locale: body.locale || state.locale,
        captchaVerifyParam: body.captchaVerifyParam,
        captchaRegion: body.captchaRegion,
      });
      sendJson(res, 200, Object.assign({ ok: !!(result && result.success) }, result || {}));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (url.pathname === '/claim' || url.pathname.startsWith('/claim/')) {
    if (claimRoutes) {
      try { await claimRoutes(req, res); } catch (e) {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: e.message });
      }
    } else sendJson(res, 501, { ok: false, error: 'claim module unavailable' });
    return;
  }

  if (url.pathname === '/zcode-config') {
    sendJson(res, 200, {
      databaseStartupId: state.databaseStartupId || null,
      hostId: state.hostId || null,
      deviceId: state.deviceMid || null,
      port: PORT,
    });
    return;
  }

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      hostRunning: !!children.host,
      hostReady: state.hostReady,
      schedulerRunning: !!children.scheduler,
      extensionHostRunning: !!children.extensionHost,
      startup: state.startup,
      uptimeMs: Date.now() - state.startedAt,
      servicePort: servicePort.id,
      node: NODE_BIN,
    });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(url.pathname, res);
    return;
  }

  if (url.pathname === '/rpc' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const id = body.id === undefined ? 1 : body.id;
      let result;
      if (body.channel && body.method) {
        result = await rpcCall(String(body.channel), String(body.method), body.params);
      } else {
        const m = resolveMethod(body.method);
        if (!m) throw new Error(`unknown method: ${body.method} (use {channel, method, params})`);
        result = await rpcCall(m[0], m[1], body.params);
      }
      sendJson(res, 200, { jsonrpc: '2.0', id, result });
    } catch (e) {
      sendJson(res, 200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: e.message } });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname !== '/zcode-service-port' || !wss) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function shutdown() {
  stopping.value = true;
  for (const c of Object.values(children)) {
    try { c.send({ __zcode: 1, t: 'parent', data: { type: 'dispose' } }); } catch (_) {}
    try { c.kill(); } catch (_) {}
  }
  try { server.close(); } catch (_) {}
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`[bootstrap] bridge listening on http://${HOST}:${PORT}`);
  spawnChild('host', path.join('host', 'index.js'), {}, (c) => {
    c.once('spawn', () => sendInitLocal());
  });
  spawnChild('scheduler', path.join('scheduler', 'index.js'), {});
  spawnChild('extensionHost', path.join('extension-host', 'index.js'), {}, (c) => {
    c.once('spawn', () => {
      c.send({ __zcode: 1, t: 'parent', data: { type: 'extension-host/init', gen: 1 } });
    });
  });
});
