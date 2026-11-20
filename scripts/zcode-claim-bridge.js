(function () {
  var CLAIM_BASE = 'http://127.0.0.1:45212';
  var ENDPOINT = CLAIM_BASE + '/claim/auto-token';
  var CLAIM_ENDPOINT = CLAIM_BASE + '/claim/claim-all';
  var OAUTH_INIT_ENDPOINT = CLAIM_BASE + '/claim/oauth-cli/init';
  var OAUTH_POLL_ENDPOINT = CLAIM_BASE + '/claim/oauth-cli/poll/';
  var seen = null;
  var autoClaimed = false;
  var panel = null;
  var statusEl = null;
  var keysEl = null;
  var resultEl = null;
  var loginEl = null;
  var loginTimer = null;

  function looksLikeJwt(value) {
    if (typeof value !== 'string' || value.length < 20 || value.length > 8192) return false;
    var parts = value.split('.');
    if (parts.length !== 3) return false;
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].length < 8 || !/^[A-Za-z0-9_-]+$/.test(parts[i])) return false;
    }
    return true;
  }

  function preferred(key) {
    return /jwt|token/i.test(key);
  }

  function walk(value, depth, path, found) {
    if (found.value || depth > 5 || value == null) return found;
    if (looksLikeJwt(value)) {
      found.value = { jwt: value, source: path };
      return found;
    }
    if (typeof value === 'string' && value.length < 16384) {
      try { return walk(JSON.parse(value), depth + 1, path, found); } catch (e) {}
      return found;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length && i < 50; i += 1) {
        walk(value[i], depth + 1, path + '[' + i + ']', found);
        if (found.value) break;
      }
      return found;
    }
    if (typeof value === 'object') {
      var keys = Object.keys(value);
      keys.sort(function (a, b) { return (preferred(b) ? 1 : 0) - (preferred(a) ? 1 : 0); });
      for (var j = 0; j < keys.length && j < 100; j += 1) {
        walk(value[keys[j]], depth + 1, path + '.' + keys[j], found);
        if (found.value) break;
      }
    }
    return found;
  }

  function findToken() {
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        var value = localStorage.getItem(key);
        if (!value) continue;
        var found = walk(value, 0, key, { value: null });
        if (found.value) {
          found.value.provider = localStorage.getItem('oauth:active_provider') || '';
          return found.value;
        }
      }
    } catch (e) {}
    return null;
  }

  function listKeys() {
    var lines = [];
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        var value = localStorage.getItem(key) || '';
        var masked = looksLikeJwt(value) ? value.slice(0, 16) + '…' : value.slice(0, 40);
        lines.push(key + ' = ' + masked);
      }
    } catch (e) {
      return 'localStorage unavailable';
    }
    return lines.join('\n') || '(empty)';
  }

  function render(found, state, result) {
    if (!statusEl || !keysEl) return;
    statusEl.textContent = found
      ? 'JWT: ' + state + ' — ' + found.source + ' (' + found.jwt.slice(0, 12) + '…)'
      : 'JWT: not found in this tab — use Login below';
    keysEl.textContent = listKeys();
    if (resultEl && result !== undefined) {
      resultEl.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
  }

  function setLogin(text) {
    if (loginEl) loginEl.textContent = text;
  }

  function randomHex(bytes) {
    var arr = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(arr);
    } else {
      for (var i = 0; i < bytes; i += 1) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(arr, function (v) {
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }

  function storeToken(jwt, provider, user) {
    var info = user || {};
    var id = info.user_id || info.id || '';
    var name = info.name || info.username || '';
    var session = {
      version: 1,
      provider: provider,
      userInfo: {
        id: id || 'unknown',
        username: name,
        displayName: name,
        avatarUrl: info.avatar || ''
      },
      zcodeJwtToken: jwt,
      revision: randomHex(16)
    };
    try {
      localStorage.setItem('oauth:browser_session', JSON.stringify(session));
      localStorage.setItem('zcodejwttoken', jwt);
      localStorage.setItem('oauth:active_provider', provider);
    } catch (e) {}
    window.dispatchEvent(new Event('zcode-browser-auth-change'));
  }

  function startLogin(provider) {
    if (loginTimer) {
      clearInterval(loginTimer);
      loginTimer = null;
    }
    var popup = window.open('about:blank', '_blank');
    if (!popup) {
      setLogin('Popup blocked — allow popups for 127.0.0.1');
      return;
    }
    setLogin('Starting ' + provider + ' login…');
    var pollToken = randomHex(32);
    var deadline = Date.now() + 10 * 60 * 1000;
    fetch(OAUTH_INIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pollToken },
      body: JSON.stringify({ provider: provider })
    }).then(function (response) {
      return response.json();
    }).then(function (payload) {
      var data = payload.data || {};
      if (payload.code !== 0 || !data.flow_id || !data.authorize_url) {
        throw new Error((payload.msg || payload.message || 'oauth init failed'));
      }
      try { popup.location.href = data.authorize_url; } catch (e) {}
      var flowId = data.flow_id;
      var interval = Math.max(1000, Math.min(5000, Number(data.poll_interval_sec || 2) * 1000));
      setLogin('Browser opened — finish login, then wait…');
      loginTimer = setInterval(function () {
        if (Date.now() > deadline) {
          clearInterval(loginTimer);
          loginTimer = null;
          setLogin('Login timeout — retry');
          return;
        }
        fetch(OAUTH_POLL_ENDPOINT + encodeURIComponent(flowId), {
          headers: { Authorization: 'Bearer ' + pollToken }
        }).then(function (response) {
          return response.json();
        }).then(function (pollPayload) {
          var result = pollPayload.data || {};
          if (result.status === 'ready' && typeof result.token === 'string' && result.token.trim()) {
            clearInterval(loginTimer);
            loginTimer = null;
            storeToken(result.token.trim(), provider, result.user);
            setLogin('Logged in — JWT saved, sending to claim server…');
            push(true);
          } else if (result.status === 'failed') {
            clearInterval(loginTimer);
            loginTimer = null;
            setLogin('Login failed — retry');
          }
        }).catch(function () {});
      }, interval);
    }).catch(function (err) {
      setLogin('OAuth init failed: ' + (err && err.message ? err.message : String(err)));
      try { popup.close(); } catch (e) {}
    });
  }

  function claimAll() {
    return fetch(CLAIM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (response) {
      return response.json().catch(function () { return { httpStatus: response.status }; });
    }).then(function (data) {
      render(findToken(), 'sent to claim server', data);
      return data;
    }).catch(function (err) {
      render(findToken(), 'sent to claim server', 'claim request failed: ' + err);
    });
  }

  function push(force) {
    var found = findToken();
    if (!found) {
      render(null, 'missing');
      return;
    }
    if (!force && found.jwt === seen) {
      render(found, 'already sent');
      return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jwt: found.jwt,
        provider: found.provider,
        locale: document.documentElement.lang || ''
      })
    }).then(function (response) {
      if (response.ok) {
        seen = found.jwt;
        render(found, 'sent to claim server');
        if (!autoClaimed) {
          autoClaimed = true;
          claimAll();
        }
      } else {
        render(found, 'HTTP ' + response.status);
      }
    }).catch(function () {
      render(found, 'fetch blocked');
    });
  }

  function widget() {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.id = 'zcode-claim-widget';
    panel.setAttribute('style', 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;background:rgba(15,17,21,.97);color:#e8e8ea;border:1px solid #3a3f4b;border-radius:12px;padding:14px;max-width:460px;box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px system-ui');
    panel.innerHTML = '<div style="font-weight:600;margin-bottom:8px">ZCode giveaway — auto JWT</div>' +
      '<div id="zcode-claim-status" style="margin-bottom:8px">checking…</div>' +
      '<div id="zcode-claim-login" style="margin-bottom:8px;color:#a7f3d0">not logged in</div>' +
      '<pre id="zcode-claim-result" style="white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;background:#10131a;padding:8px;border-radius:8px;font-size:11px"></pre>' +
      '<pre id="zcode-claim-keys" style="white-space:pre-wrap;word-break:break-all;max-height:100px;overflow:auto;background:#151821;padding:8px;border-radius:8px;font-size:10px;opacity:.75"></pre>' +
      '<button id="zcode-login-global" style="background:#16a34a;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Login (Global)</button>' +
      '<button id="zcode-login-cn" style="background:#16a34a;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Login (CN)</button>' +
      '<button id="zcode-claim-retry" style="background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Retry</button>' +
      '<button id="zcode-claim-now" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Claim all</button>' +
      '<button id="zcode-claim-open" style="background:#3b3f4a;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Claim page</button>' +
      '<button id="zcode-claim-close" style="background:#3b3f4a;color:#fff;border:0;border-radius:8px;padding:7px 10px">Close</button>';
    document.body.appendChild(panel);
    statusEl = panel.querySelector('#zcode-claim-status');
    keysEl = panel.querySelector('#zcode-claim-keys');
    resultEl = panel.querySelector('#zcode-claim-result');
    loginEl = panel.querySelector('#zcode-claim-login');
    panel.querySelector('#zcode-login-global').onclick = function () { startLogin('zai'); };
    panel.querySelector('#zcode-login-cn').onclick = function () { startLogin('zai_cn'); };
    panel.querySelector('#zcode-claim-retry').onclick = function () { push(true); };
    panel.querySelector('#zcode-claim-now').onclick = function () { claimAll(); };
    panel.querySelector('#zcode-claim-open').onclick = function () {
      window.open('http://127.0.0.1:45212/claim', '_blank');
    };
    panel.querySelector('#zcode-claim-close').onclick = function () {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      if (loginTimer) {
        clearInterval(loginTimer);
        loginTimer = null;
      }
      panel = null;
      statusEl = null;
      keysEl = null;
      resultEl = null;
      loginEl = null;
    };
  }

  window.addEventListener('zcode-browser-auth-change', function () { push(true); });
  window.addEventListener('storage', function (event) {
    if (!event.key || event.key.indexOf('oauth:') === 0 || /jwt|token/i.test(event.key)) push(true);
  });
  setInterval(function () { push(false); }, 2000);
  document.addEventListener('DOMContentLoaded', widget);
  if (document.body) widget();
  push(false);
})();
