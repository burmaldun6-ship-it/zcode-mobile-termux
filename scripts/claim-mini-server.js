const http = require('http');
const path = require('path');
const BASE = path.join(__dirname, '..', 'claim');
const claim = require(path.join(BASE, 'claim.js'));
const claimServer = require(path.join(BASE, 'claim-server.js'));
const PORT = Number(process.env.CLAIM_PORT || 45212);

// Promo tokens console. Visual system follows the official ZCode/Z.ai app:
// near-black monochrome surfaces, one #1F63EC accent, system sans + mono details,
// monoline SVG icons (no emoji), phone-first layout.
const PAGE = `<!doctype html><html lang="en" data-zcode-design><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZCode · Promo tokens</title><style>
:root{
  --bg:#0d0d0d;--surface:#171717;--surface-2:#1e1e20;--border:rgba(255,255,255,.08);--border-strong:rgba(255,255,255,.14);
  --text:#f3f3f3;--text-2:#b4b4b4;--text-3:#828282;
  --accent:#1F63EC;--accent-press:#1a54c8;--accent-soft:rgba(31,99,236,.12);
  --ok:#3fb950;--ok-soft:rgba(63,185,80,.12);--err:#f85149;--warn:#d29922;
  --white:#fff;--border-hover:rgba(255,255,255,.24);--toast-bg:#1c1c1e;--shadow:0 8px 24px rgba(0,0,0,.55);
  --radius:12px;--radius-btn:10px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Noto Sans","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 var(--font);-webkit-font-smoothing:antialiased}
.wrap{max-width:620px;margin:0 auto;padding:0 16px 48px}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.rise{animation:rise .35s ease both}
.rise:nth-child(2){animation-delay:.05s}.rise:nth-child(3){animation-delay:.1s}.rise:nth-child(4){animation-delay:.15s}
@media (prefers-reduced-motion:reduce){.rise{animation:none}}
/* top bar */
.top{display:flex;align-items:center;gap:10px;padding:16px 0 20px}
.mark{width:30px;height:30px;border-radius:8px;background:var(--surface);border:1px solid var(--border-strong);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.mark svg{display:block}
.top h1{font-size:15px;font-weight:600;margin:0;letter-spacing:.01em}
.top .sub{color:var(--text-3);font-size:12px}
.top .spacer{flex:1}
.conn{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums}
.dot{width:7px;height:7px;border-radius:50%;background:var(--text-3)}
.dot.ok{background:var(--ok)}.dot.err{background:var(--err)}
/* session card */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;margin-bottom:14px}
.card h2{font-size:16px;font-weight:600;margin:0 0 4px}
.card .lead{color:var(--text-2);margin:0 0 14px;font-size:13px}
.row{display:flex;gap:8px;flex-wrap:wrap}
.session-on{display:flex;align-items:flex-start;gap:12px}
.session-on .ic{width:34px;height:34px;border-radius:9px;background:var(--ok-soft);color:var(--ok);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip{font:11px/1 var(--mono);color:var(--text-2);background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 7px}
.chip b{color:var(--text);font-weight:600}
.hint{color:var(--text-3);font-size:12px;margin:12px 0 0}
/* buttons */
button{font:inherit;cursor:pointer;border:0;transition:transform .06s ease,background-color .15s ease,border-color .15s ease,opacity .15s ease}
button:active{transform:scale(.98)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:var(--radius-btn);padding:9px 14px;font-size:13px;font-weight:500}
.btn svg{flex-shrink:0}
.btn-primary{background:var(--accent);color:var(--white)}
.btn-primary:hover{background:var(--accent-press)}
.btn-secondary{background:var(--surface-2);color:var(--text);border:1px solid var(--border-strong)}
.btn-secondary:hover{border-color:var(--border-hover)}
.btn-ghost{background:transparent;color:var(--text-2);border:1px solid var(--border)}
.btn-ghost:hover{color:var(--text);border-color:var(--border-strong)}
.btn-big{width:100%;padding:12px 16px;font-size:14px;font-weight:600}
.btn[disabled]{opacity:.45;cursor:default;pointer-events:none}
/* sections */
.sect{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px}
.sect h3{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin:0}
.iconbtn{display:inline-flex;align-items:center;gap:6px;background:transparent;color:var(--text-3);border:1px solid var(--border);border-radius:8px;padding:6px 9px;font-size:12px}
.iconbtn:hover{color:var(--text);border-color:var(--border-strong)}
/* campaigns */
.camp{display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:8px}
.camp .ic{width:36px;height:36px;border-radius:9px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.camp .info{min-width:0;flex:1}
.camp .name{font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.camp .meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
.camp .btn{flex-shrink:0;padding:7px 12px}
.empty{color:var(--text-3);font-size:13px;background:var(--surface);border:1px dashed var(--border-strong);border-radius:var(--radius);padding:18px;text-align:center}
/* history */
.hist{display:flex;align-items:baseline;gap:9px;padding:9px 2px;border-bottom:1px solid var(--border);font-size:13px}
.hist:last-child{border-bottom:0}
.hist .st{flex-shrink:0;align-self:center}
.hist .st.ok{color:var(--ok)}.hist .st.err{color:var(--err)}.hist .st.warn{color:var(--warn)}
.hist .plan{font-family:var(--mono);font-size:12px;color:var(--text)}
.hist .msg{color:var(--text-2);min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hist .ts{font-family:var(--mono);font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums;flex-shrink:0}
.hist-sum{color:var(--text-3);font-size:12px;padding:8px 2px;font-variant-numeric:tabular-nums}
/* details */
details.adv{border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);margin-top:22px}
details.adv summary{cursor:pointer;padding:13px 16px;font-size:12px;color:var(--text-3);list-style:none;display:flex;align-items:center;gap:7px}
details.adv summary::-webkit-details-marker{display:none}
details.adv summary:hover{color:var(--text-2)}
details.adv .inner{padding:0 16px 16px}
textarea{width:100%;background:var(--surface-2);color:var(--text);border:1px solid var(--border-strong);border-radius:var(--radius-btn);padding:10px;font:12px/1.5 var(--mono);resize:vertical;min-height:64px}
textarea:focus{outline:none;border-color:var(--accent)}
pre.json{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-btn);padding:10px;font:11px/1.5 var(--mono);color:var(--text-2);overflow:auto;max-height:220px;margin:10px 0 0;white-space:pre-wrap;word-break:break-word}
/* footer */
.foot{color:var(--text-3);font-size:11px;margin-top:26px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.foot .sep{opacity:.4}
/* toasts */
#toast-root{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:center;width:max-content;max-width:calc(100vw - 32px)}
.toast{display:flex;align-items:center;gap:9px;background:var(--toast-bg);border:1px solid var(--border-strong);border-radius:10px;padding:10px 14px;font-size:13px;box-shadow:var(--shadow);max-width:100%;animation:rise .25s ease both}
.toast svg{flex-shrink:0}
.toast.ok svg{color:var(--ok)}.toast.err svg{color:var(--err)}.toast.warn svg{color:var(--warn)}.toast.info svg{color:var(--accent)}
.toast span{min-width:0;overflow:hidden;text-overflow:ellipsis}
/* captcha mount (invisible, official SDK renders its own popup) */
.captcha-mount{position:fixed;left:0;top:0;z-index:2147483600;width:0;height:0;overflow:visible}
.captcha-el{position:absolute;left:0;top:0;width:0;height:0;overflow:visible}
.captcha-btn{position:fixed;left:50%;top:50%;width:1px;height:1px;border:0;padding:0;transform:translate(-50%,-50%);opacity:0}
</style></head><body>
<div class="wrap">
  <div class="top">
    <div class="mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text)"><path d="M5 5h14L7 19h12"/></svg></div>
    <div><h1>ZCode</h1><div class="sub">Promo tokens</div></div>
    <div class="spacer"></div>
    <div class="conn"><span class="dot" id="conn-dot"></span><span id="conn-label">connecting</span></div>
  </div>

  <div class="card rise" id="sess-card"><div class="hint">Checking session…</div></div>

  <div class="sect rise"><h3>Available giveaways</h3>
    <button class="iconbtn" id="camp-refresh" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>Refresh</button>
  </div>
  <div id="camp-list" class="rise"><div class="empty">Sign in to check available giveaways.</div></div>

  <div class="rise" style="margin-top:14px">
    <button class="btn btn-primary btn-big" id="claim-all-btn" type="button" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>
      Claim all available
    </button>
  </div>

  <div class="sect rise"><h3>Received</h3></div>
  <div class="card rise" id="hist-card" style="padding:8px 14px"><div class="hist-sum">Nothing claimed yet.</div></div>

  <details class="adv rise">
    <summary><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Advanced</summary>
    <div class="inner">
      <div class="hint" style="margin:0 0 8px">Manual session token, only if popup login is blocked. The token stays on this device.</div>
      <textarea id="jwt-input" rows="3" placeholder="paste JWT (zcodejwttoken)"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn btn-secondary" id="jwt-save" type="button">Save token</button></div>
      <pre class="json" id="status-json">status: —</pre>
    </div>
  </details>

  <div class="foot"><span>loopback only · 127.0.0.1:${PORT}</span><span class="sep">·</span><span>claims log: ~/.zcode-mobile/logs/claims.log</span></div>
</div>
<div id="toast-root"></div>
<div class="captcha-mount" aria-hidden="true"><div class="captcha-el" id="captcha-el"></div><button class="captcha-btn" type="button" tabindex="-1" aria-hidden="true" id="captcha-btn"></button></div>
<script>
(function () {
  'use strict';
  var claimBusy = false;
  var captchaBusy = false;
  var campaignsBusy = false;
  var loginTimer = null;
  var configured = false;
  var campaignsCache = null;

  function $(id) { return document.getElementById(id); }

  var ICONS = {
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h5l-5 5h5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
    circleX: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    skip: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  function icon(name, size, stroke) {
    return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (stroke || 1.7) + '" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function toast(kind, text) {
    var iconName = kind === 'ok' ? 'circleCheck' : kind === 'err' ? 'circleX' : kind === 'warn' ? 'alert' : 'coin';
    var el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = icon(iconName, 15);
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    $('toast-root').appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var msg = data && data.error && data.error.message ? data.error.message : 'HTTP ' + r.status;
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  // ---------- session ----------

  function renderSession(state) {
    var card = $('sess-card');
    card.textContent = '';
    if (!state || !state.configured) {
      var h = document.createElement('h2');
      h.textContent = 'Sign in to z.ai';
      var p = document.createElement('p');
      p.className = 'lead';
      p.textContent = 'Token giveaways are tied to your ZCode / Z.ai account. A popup window opens, you sign in, and the session token is stored locally on this device.';
      var row = document.createElement('div');
      row.className = 'row';
      var b1 = document.createElement('button');
      b1.className = 'btn btn-primary';
      b1.type = 'button';
      b1.innerHTML = icon('arrow', 14) + '<span>Sign in · Global</span>';
      b1.onclick = function () { startLogin('zai'); };
      var b2 = document.createElement('button');
      b2.className = 'btn btn-secondary';
      b2.type = 'button';
      b2.innerHTML = icon('arrow', 14) + '<span>Sign in · CN</span>';
      b2.onclick = function () { startLogin('zai_cn'); };
      row.appendChild(b1);
      row.appendChild(b2);
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Popup blocked? Save the token manually under Advanced.';
      card.appendChild(h);
      card.appendChild(p);
      card.appendChild(row);
      card.appendChild(hint);
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'session-on';
    var box = document.createElement('div');
    box.className = 'ic';
    box.innerHTML = icon('circleCheck', 18);
    var info = document.createElement('div');
    var t = document.createElement('h2');
    t.textContent = 'Session active';
    t.style.marginBottom = '0';
    var sub = document.createElement('div');
    sub.className = 'lead';
    sub.style.margin = '4px 0 0';
    sub.textContent = 'Giveaways claim against this account. The token also forwards automatically from the ZCode web UI.';
    var chips = document.createElement('div');
    chips.className = 'chips';
    function chip(label, value) {
      var c = document.createElement('span');
      c.className = 'chip';
      c.appendChild(document.createTextNode(label + ' '));
      var b = document.createElement('b');
      b.textContent = value;
      c.appendChild(b);
      return c;
    }
    if (state.platform) chips.appendChild(chip('platform', state.platform));
    if (state.locale) chips.appendChild(chip('locale', state.locale));
    if (state.seq !== undefined) chips.appendChild(chip('seq', String(state.seq)));
    var lr = state.lastResult;
    if (lr && lr.finishedAt) {
      chips.appendChild(chip('last run', fmtTime(lr.finishedAt) + (lr.claimedCount !== undefined ? ' · +' + lr.claimedCount : '')));
    }
    info.appendChild(t);
    info.appendChild(sub);
    info.appendChild(chips);
    wrap.appendChild(box);
    wrap.appendChild(info);
    card.appendChild(wrap);
  }

  function status() {
    return api('/claim/status').then(function (payload) {
      var state = payload && payload.state ? payload.state : {};
      configured = !!state.configured;
      $('conn-dot').className = 'dot ok';
      $('conn-label').textContent = 'connected';
      renderSession(state);
      $('status-json').textContent = JSON.stringify(state, null, 2);
      updateClaimAll();
      return payload;
    }).catch(function () {
      $('conn-dot').className = 'dot err';
      $('conn-label').textContent = 'offline';
    });
  }

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
    else for (var i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(arr, function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }

  // ---------- login ----------

  function startLogin(provider) {
    if (loginTimer) { clearInterval(loginTimer); loginTimer = null; }
    var popup = window.open('about:blank', '_blank');
    if (!popup) {
      toast('warn', 'Popup blocked — allow popups or use Advanced to paste a token.');
      return;
    }
    toast('info', 'Opening ' + provider + ' sign-in…');
    var pollToken = randomHex(32);
    var deadline = Date.now() + 10 * 60 * 1000;
    api('/claim/oauth-cli/init', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + pollToken },
      body: JSON.stringify({ provider: provider })
    }).then(function (payload) {
      var data = payload.data || {};
      if (payload.code !== 0 || !data.flow_id || !data.authorize_url) {
        throw new Error(payload.msg || payload.message || 'oauth init failed');
      }
      try { popup.location.href = data.authorize_url; } catch (e) {}
      var flowId = data.flow_id;
      var interval = Math.max(1000, Math.min(5000, Number(data.poll_interval_sec || 2) * 1000));
      loginTimer = setInterval(function () {
        if (Date.now() > deadline) {
          clearInterval(loginTimer);
          loginTimer = null;
          toast('err', 'Sign-in timed out — try again.');
          return;
        }
        fetch('/claim/oauth-cli/poll/' + encodeURIComponent(flowId), {
          headers: { Authorization: 'Bearer ' + pollToken }
        }).then(function (r) { return r.json(); }).then(function (pollPayload) {
          var result = pollPayload.data || {};
          if (result.status === 'ready' && typeof result.token === 'string' && result.token.trim()) {
            clearInterval(loginTimer);
            loginTimer = null;
            try { popup.close(); } catch (e) {}
            return api('/claim/auto-token', {
              method: 'POST',
              body: JSON.stringify({ jwt: result.token.trim(), provider: provider, locale: document.documentElement.lang || '' })
            }).then(function () {
              toast('ok', 'Signed in — session stored locally.');
              return status();
            }).then(function () { return loadCampaigns(true); }).then(function () {
              runClaim();
            });
          }
          if (result.status === 'failed') {
            clearInterval(loginTimer);
            loginTimer = null;
            try { popup.close(); } catch (e) {}
            toast('err', 'Sign-in failed — please retry.');
          }
        }).catch(function () {});
      }, interval);
    }).catch(function (err) {
      try { popup.close(); } catch (e) {}
      toast('err', 'Sign-in failed: ' + (err && err.message ? err.message : err));
    });
  }

  function saveJwt() {
    var token = $('jwt-input').value.trim();
    if (!token) {
      toast('warn', 'Paste a token first.');
      return;
    }
    api('/claim/start', { method: 'POST', body: JSON.stringify({ jwt: token }) }).then(function () {
      $('jwt-input').value = '';
      toast('ok', 'Token saved.');
      return status();
    }).then(function () { return loadCampaigns(true); }).catch(function (err) {
      toast('err', 'Save failed: ' + (err && err.message ? err.message : err));
    });
  }

  // ---------- campaigns ----------

  function loadCampaigns(force) {
    if (campaignsBusy) return Promise.resolve();
    if (!force && campaignsCache) { renderCampaigns(campaignsCache); return Promise.resolve(); }
    if (!configured) {
      renderCampaigns(null);
      return Promise.resolve();
    }
    campaignsBusy = true;
    var list = $('camp-list');
    if (!list.firstChild || !list.firstChild.classList || !list.firstChild.classList.contains('camp')) {
      list.textContent = '';
      var load = document.createElement('div');
      load.className = 'empty';
      load.textContent = 'Loading giveaways…';
      list.appendChild(load);
    }
    return api('/claim/campaigns').then(function (payload) {
      campaignsCache = payload && Array.isArray(payload.claimActions) ? payload.claimActions : [];
      renderCampaigns(campaignsCache);
    }).catch(function (err) {
      var list2 = $('camp-list');
      list2.textContent = '';
      var fail = document.createElement('div');
      fail.className = 'empty';
      fail.textContent = 'Could not load giveaways: ' + (err && err.message ? err.message : err);
      list2.appendChild(fail);
    }).then(function () { campaignsBusy = false; });
  }

  function renderCampaigns(actions) {
    var list = $('camp-list');
    list.textContent = '';
    if (!configured) {
      var need = document.createElement('div');
      need.className = 'empty';
      need.textContent = 'Sign in to check available giveaways.';
      list.appendChild(need);
      updateClaimAll();
      return;
    }
    if (!actions || !actions.length) {
      var none = document.createElement('div');
      none.className = 'empty';
      none.textContent = 'No giveaways available right now — check again later.';
      list.appendChild(none);
      updateClaimAll();
      return;
    }
    for (var i = 0; i < actions.length && i < 12; i += 1) {
      var a = actions[i];
      var card = document.createElement('div');
      card.className = 'camp';
      var box = document.createElement('div');
      box.className = 'ic';
      box.innerHTML = icon('coin', 18);
      var info = document.createElement('div');
      info.className = 'info';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.buttonLabel || 'Promo token';
      var meta = document.createElement('div');
      meta.className = 'meta';
      var p1 = document.createElement('span');
      p1.className = 'chip';
      p1.textContent = a.planId;
      meta.appendChild(p1);
      var p2 = document.createElement('span');
      p2.className = 'chip';
      p2.textContent = a.campaignId + ' · ' + a.resourcePosition;
      meta.appendChild(p2);
      info.appendChild(name);
      info.appendChild(meta);
      var btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.type = 'button';
      btn.innerHTML = icon('zap', 13) + '<span>Claim</span>';
      btn.onclick = (function (planId) {
        return function () { runClaim(planId); };
      })(a.planId);
      card.appendChild(box);
      card.appendChild(info);
      card.appendChild(btn);
      list.appendChild(card);
    }
    updateClaimAll();
  }

  function updateClaimAll() {
    var btn = $('claim-all-btn');
    btn.disabled = !configured || claimBusy;
  }

  // ---------- history ----------

  function loadHistory() {
    return api('/claim/history').then(function (payload) {
      var card = $('hist-card');
      card.textContent = '';
      var history = payload && Array.isArray(payload.history) ? payload.history : [];
      var claims = history.filter(function (e) { return e.type === 'claim'; });
      if (!claims.length) {
        var none = document.createElement('div');
        none.className = 'hist-sum';
        none.textContent = 'Nothing claimed yet.';
        card.appendChild(none);
        return;
      }
      for (var i = 0; i < history.length && i < 20; i += 1) {
        var e = history[i];
        if (e.type === 'summary') {
          var sum = document.createElement('div');
          sum.className = 'hist-sum';
          sum.textContent = 'Run: claimed ' + e.claimedCount + ', failed ' + e.failedCount + (e.captchaRequired ? ' · captcha required' : '') + ' · ' + fmtTime(e.ts);
          card.appendChild(sum);
          continue;
        }
        var row = document.createElement('div');
        row.className = 'hist';
        var st = document.createElement('span');
        st.className = 'st ' + (e.ok ? 'ok' : (e.status === 'skipped_captcha_required' ? 'warn' : 'err'));
        st.innerHTML = icon(e.ok ? 'circleCheck' : (e.status === 'skipped_captcha_required' ? 'skip' : 'circleX'), 15);
        var plan = document.createElement('span');
        plan.className = 'plan';
        plan.textContent = e.planId || '?';
        var msg = document.createElement('span');
        msg.className = 'msg';
        msg.textContent = e.ok ? (e.message || 'claimed') : (e.message || e.status || 'failed');
        msg.title = msg.textContent;
        var ts = document.createElement('span');
        ts.className = 'ts';
        ts.textContent = fmtTime(e.ts);
        row.appendChild(st);
        row.appendChild(plan);
        row.appendChild(msg);
        row.appendChild(ts);
        card.appendChild(row);
      }
    }).catch(function () {});
  }

  // ---------- captcha (official Aliyun SDK, same flow as the chat widget) ----------

  var CAPTCHA_SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
  var captchaSdkPromise = null;

  function loadCaptchaSdk() {
    if (typeof window.initAliyunCaptcha === 'function') return Promise.resolve();
    if (captchaSdkPromise) return captchaSdkPromise;
    captchaSdkPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + CAPTCHA_SDK_URL + '"]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); }, { once: true });
        existing.addEventListener('error', function () {
          captchaSdkPromise = null;
          reject(new Error('Failed to load captcha script.'));
        }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = CAPTCHA_SDK_URL;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        captchaSdkPromise = null;
        reject(new Error('Failed to load captcha script.'));
      };
      document.head.appendChild(script);
    });
    return captchaSdkPromise;
  }

  function solveCaptcha(config) {
    if (captchaBusy) return Promise.reject(new Error('Captcha verification is already in progress.'));
    if (config.enabled === false || !config.region || !config.prefix || !config.sceneId) {
      return Promise.reject(new Error('Request verification configuration is invalid'));
    }
    captchaBusy = true;
    return loadCaptchaSdk().then(function () {
      return new Promise(function (resolve, reject) {
        if (typeof window.initAliyunCaptcha !== 'function') {
          captchaBusy = false;
          reject(new Error('Captcha SDK is unavailable.'));
          return;
        }
        var button = $('captcha-btn');
        var settled = false;
        var timer = null;
        var language = (document.documentElement.lang || navigator.language || 'en').toLowerCase().indexOf('zh') === 0 ? 'cn' : 'en';
        function finish(err, value) {
          if (settled) return;
          settled = true;
          captchaBusy = false;
          if (timer) clearTimeout(timer);
          try { window.AliyunCaptchaConfig = null; } catch (e) {}
          if (err) reject(err); else resolve(value);
        }
        timer = setTimeout(function () {
          finish(new Error('Captcha verification timed out after 120000ms.'));
        }, 120000);
        window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
        try {
          window.initAliyunCaptcha({
            SceneId: config.sceneId,
            region: config.region,
            prefix: config.prefix,
            mode: 'popup',
            language: language,
            showErrorTip: false,
            element: '#captcha-el',
            button: '#captcha-btn',
            getInstance: function () {
              toast('info', 'Complete the verification in the popup window.');
              if (button) button.click();
            },
            success: function (param) {
              var value = typeof param === 'string' ? param.trim() : '';
              if (!value) return;
              finish(null, { captchaVerifyParam: value, captchaRegion: config.region });
            },
            fail: function (result) {
              var terminal = result && (result.captchaVerifyParam || result.CaptchaVerifyParam);
              if (typeof terminal === 'string' && terminal.trim()) {
                finish(null, { captchaVerifyParam: terminal.trim(), captchaRegion: config.region });
                return;
              }
              var code = result && (result.verifyCode || result.VerifyCode || result.code);
              var needUi = result && result.success === true && result.verifyResult === false && (!code || code === 'F015');
              if (needUi && button) {
                toast('info', 'Please complete the verification puzzle.');
                button.click();
                return;
              }
              finish(new Error('Captcha failed: ' + (code || 'unknown')));
            },
            onError: function (err) {
              finish(err instanceof Error ? err : new Error(String(err)));
            }
          });
        } catch (err) {
          finish(err);
        }
      });
    }).catch(function (err) {
      captchaBusy = false;
      throw err;
    });
  }

  // ---------- claim ----------

  function announceClaim(data) {
    if (!data || typeof data !== 'object') return;
    if (data.captcha && data.captcha.required) {
      toast('warn', 'Captcha required before claiming.');
      return;
    }
    var claimed = [];
    var failed = [];
    if (Array.isArray(data.actions)) {
      for (var i = 0; i < data.actions.length; i += 1) {
        var action = data.actions[i];
        if (action.claim && action.claim.success) claimed.push(action.planId);
        else if (action.status && action.status !== 'pending') failed.push(action.planId);
      }
    }
    if (claimed.length) toast('ok', 'Token claimed: ' + claimed.join(', '));
    else if (failed.length) {
      var reason = data.errors && data.errors[0] && data.errors[0].message;
      toast('err', 'Claim failed for ' + failed.join(', ') + (reason ? ': ' + reason : ''));
    } else if (data.ok === false && data.errors && data.errors.length) {
      toast('err', 'Claim failed: ' + data.errors[0].message);
    } else if (data.ok) {
      toast('info', 'Nothing new to claim.');
    }
  }

  function runClaim(planId) {
    if (claimBusy) {
      toast('warn', 'Another claim is already in progress…');
      return;
    }
    claimBusy = true;
    updateClaimAll();
    return api('/claim/captcha-config', { method: 'POST', body: '{}' }).then(function (data) {
      var config = data.config || {};
      if (data.enabled && config.region && config.prefix && config.sceneId) {
        toast('info', 'Opening the official verification window…');
        return solveCaptcha(config).then(function (solved) {
          toast('info', 'Verification solved — sending claim…');
          return sendClaim(solved, planId);
        });
      }
      return sendClaim(undefined, planId);
    }).catch(function (err) {
      toast('err', 'Claim failed: ' + (err && err.message ? err.message : err));
    }).then(function () {
      claimBusy = false;
      updateClaimAll();
      status();
      loadHistory();
      loadCampaigns(true);
    });
  }

  function sendClaim(captcha, planId) {
    var body = captcha || {};
    if (planId) body.planId = planId;
    return api('/claim/claim-all', { method: 'POST', body: JSON.stringify(body) }).then(function (data) {
      announceClaim(data);
      $('status-json').textContent = JSON.stringify(data, null, 2);
      return data;
    });
  }

  // ---------- init ----------

  $('camp-refresh').onclick = function () { loadCampaigns(true); };
  $('claim-all-btn').onclick = function () { runClaim(); };
  $('jwt-save').onclick = saveJwt;
  status().then(function () { return loadCampaigns(true); });
  loadHistory();
  setInterval(status, 4000);
})();
</script>
</body></html>`;

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
      claimServer.recordClaimHistory([{
        type: 'claim',
        ok: !!result.success,
        status: result.success ? 'claimed' : (result.terminal ? 'claim_failed_terminal' : 'claim_failed'),
        planId: body.planId || body.plan_id || 'unknown',
        code: result.code,
        message: result.message,
      }]);
      console.log('[claim] single plan ' + (body.planId || body.plan_id) + ' ok=' + !!result.success + ' code=' + result.code);
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
