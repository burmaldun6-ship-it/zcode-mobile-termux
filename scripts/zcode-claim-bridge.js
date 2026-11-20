(function () {
  var CLAIM_BASE = 'http://127.0.0.1:45212';
  var ENDPOINT = CLAIM_BASE + '/claim/auto-token';
  var CLAIM_ENDPOINT = CLAIM_BASE + '/claim/claim-all';
  var STATUS_ENDPOINT = CLAIM_BASE + '/claim/status';
  var CAMPAIGNS_ENDPOINT = CLAIM_BASE + '/claim/campaigns';
  var HISTORY_ENDPOINT = CLAIM_BASE + '/claim/history';
  var OAUTH_INIT_ENDPOINT = CLAIM_BASE + '/claim/oauth-cli/init';
  var OAUTH_POLL_ENDPOINT = CLAIM_BASE + '/claim/oauth-cli/poll/';
  var CAPTCHA_CONFIG_ENDPOINT = CLAIM_BASE + '/claim/captcha-config';
  var CAPTCHA_SDK_URL = 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js';
  var CAMPAIGNS_CACHE_KEY = 'zcode-claim-campaigns-cache';
  var CAMPAIGNS_CACHE_TTL = 10 * 60 * 1000;
  var captchaSdkPromise = null;
  var captchaBusy = false;
  var claimBusy = false;
  var campaignsBusy = false;
  var seen = null;
  var autoClaimed = false;
  var autoClaimPending = false;
  var configured = false;
  var availableCount = null;
  var pill = null;
  var pillBadge = null;
  var pillDot = null;
  var panel = null;
  var uiStatusEl = null;
  var uiLoginRow = null;
  var uiAvailableEl = null;
  var uiHistoryEl = null;
  var uiResultEl = null;
  var debugPanelEl = null;
  var statusEl = null;
  var keysEl = null;
  var resultEl = null;
  var loginEl = null;
  var loginTimer = null;
  var loggedJwt = null;
  var lastPollStatus = '';
  var LOG_ENDPOINT = CLAIM_BASE + '/claim/log';
  // Visual tokens follow the official ZCode/Z.ai app: near-black monochrome,
  // one #1F63EC accent, monoline SVG icons (no emoji).
  var T = {
    bg: 'rgba(13,13,13,.96)',
    surface: '#1e1e20',
    border: 'rgba(255,255,255,.08)',
    borderStrong: 'rgba(255,255,255,.14)',
    text: '#f3f3f3',
    text2: '#b4b4b4',
    text3: '#828282',
    accent: '#1F63EC',
    accentPress: '#1a54c8',
    accentSoft: 'rgba(31,99,236,.12)',
    ok: '#3fb950',
    err: '#f85149',
    warn: '#d29922',
    font: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Noto Sans","Microsoft YaHei",sans-serif',
    mono: 'ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace'
  };
  var ICONS = {
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h5l-5 5h5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
    x: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    skip: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  function icon(name, size) {
    return '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }
  if (/[?&]zcodeDebug=0/.test(window.location.search)) {
    try { localStorage.removeItem('zcode-claim-debug'); } catch (e) {}
  }
  var DEBUG = /[?&]zcodeDebug=1/.test(window.location.search) || localStorage.getItem('zcode-claim-debug') === '1';
  if (DEBUG) {
    try { localStorage.setItem('zcode-claim-debug', '1'); } catch (e) {}
  }

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
          if (loggedJwt !== found.value.jwt) {
            loggedJwt = found.value.jwt;
            log('info', 'JWT found in browser storage', {
              source: found.value.source,
              provider: found.value.provider,
              prefix: found.value.jwt.slice(0, 12)
            });
          }
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

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      ' ' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function toast(message, kind) {
    if (!document.body) return;
    var iconName = kind === 'ok' ? 'check' : kind === 'err' ? 'x' : kind === 'warn' ? 'alert' : 'coin';
    var color = kind === 'ok' ? T.ok : kind === 'err' ? T.err : kind === 'warn' ? T.warn : T.accent;
    var el = document.createElement('div');
    el.setAttribute('style', 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'z-index:2147483647;display:flex;align-items:center;gap:9px;background:#1c1c1e;color:' + T.text + ';' +
      'border:1px solid ' + T.borderStrong + ';border-radius:10px;padding:10px 14px;font:13px/1.4 ' + T.font + ';' +
      'box-shadow:0 8px 24px rgba(0,0,0,.55);max-width:calc(100vw - 32px)');
    var ic = document.createElement('span');
    ic.setAttribute('style', 'display:flex;flex-shrink:0;color:' + color);
    ic.innerHTML = icon(iconName, 15);
    var span = document.createElement('span');
    span.textContent = message;
    el.appendChild(ic);
    el.appendChild(span);
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4500);
  }

  function setBadge() {
    if (!pillBadge) return;
    var n = availableCount;
    pillBadge.textContent = (n === null || n === undefined) ? '' : String(n);
    pill.style.borderColor = configured ? T.borderStrong : T.border;
    if (pillDot) pillDot.style.background = configured ? T.ok : T.text3;
  }

  function render(found, state, result) {
    if (uiResultEl && result !== undefined) {
      uiResultEl.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      uiResultEl.style.display = 'block';
    }
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
    if (uiStatusEl) uiStatusEl.textContent = text;
    if (loginEl) loginEl.textContent = text;
  }

  function log(level, message, data) {
    if (!DEBUG) return;
    try { console.log('[zcode-claim] ' + message, data || ''); } catch (e) {}
    try {
      fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: level,
          source: 'zcode-claim-bridge',
          message: message,
          data: data || null
        })
      });
    } catch (e) {}
  }

  // ---------- remote state ----------

  function fetchStatus() {
    return fetch(STATUS_ENDPOINT).then(function (response) {
      return response.json();
    }).then(function (payload) {
      var state = payload && payload.state ? payload.state : {};
      configured = !!state.configured;
      if (configured && (availableCount === null || availableCount === undefined)) {
        var cached = cachedCampaigns();
        if (cached) {
          availableCount = cached.length;
        }
      }
      setBadge();
      updateLoginRow();
      if (uiStatusEl && !claimBusy && !loginTimer) {
        uiStatusEl.textContent = configured
          ? 'Session active — token received from the web UI.'
          : 'Not signed in — use the buttons below.';
      }
      return payload;
    }).catch(function () {});
  }

  function cachedCampaigns() {
    try {
      var raw = localStorage.getItem(CAMPAIGNS_CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.claimActions)) return null;
      if (Date.now() - parsed.at > CAMPAIGNS_CACHE_TTL) return parsed.claimActions;
      return parsed.claimActions;
    } catch (e) {
      return null;
    }
  }

  function renderAvailable(actions) {
    if (!uiAvailableEl) return;
    uiAvailableEl.textContent = '';
    if (!actions || !actions.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'color:' + T.text3 + ';padding:4px 0;font-size:12px';
      empty.textContent = configured
        ? 'No giveaways available right now — check again later.'
        : 'Sign in to check available giveaways.';
      uiAvailableEl.appendChild(empty);
      return;
    }
    for (var i = 0; i < actions.length && i < 10; i += 1) {
      var action = actions[i];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid ' + T.border;
      var label = document.createElement('div');
      label.style.cssText = 'min-width:0';
      var title = document.createElement('div');
      title.style.cssText = 'font-size:13px;font-weight:500;color:' + T.text + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      title.textContent = action.buttonLabel || 'Promo token';
      var meta = document.createElement('div');
      meta.style.cssText = 'margin-top:4px;display:flex;gap:5px;flex-wrap:wrap';
      var chip1 = document.createElement('span');
      chip1.style.cssText = 'font:11px/1 ' + T.mono + ';color:' + T.text2 + ';background:' + T.surface + ';border:1px solid ' + T.border + ';border-radius:6px;padding:3px 6px';
      chip1.textContent = action.planId;
      var chip2 = document.createElement('span');
      chip2.style.cssText = 'font:11px/1 ' + T.mono + ';color:' + T.text3 + ';border:1px solid ' + T.border + ';border-radius:6px;padding:3px 6px';
      chip2.textContent = action.resourcePosition;
      meta.appendChild(chip1);
      meta.appendChild(chip2);
      label.appendChild(title);
      label.appendChild(meta);
      var button = document.createElement('button');
      button.style.cssText = 'display:inline-flex;align-items:center;gap:5px;background:' + T.accent + ';color:#fff;border:0;border-radius:8px;padding:6px 11px;cursor:pointer;flex-shrink:0;font:12px ' + T.font + ';transition:background-color .15s ease';
      button.innerHTML = icon('zap', 12) + '<span>Claim</span>';
      button.onmouseover = function () { this.style.backgroundColor = T.accentPress; };
      button.onmouseout = function () { this.style.backgroundColor = T.accent; };
      button.onclick = (function (planId) {
        return function () { runClaimWithCaptcha(planId); };
      })(action.planId);
      row.appendChild(label);
      row.appendChild(button);
      uiAvailableEl.appendChild(row);
    }
  }

  function refreshCampaigns(force) {
    var cached = force ? null : cachedCampaigns();
    if (cached) {
      availableCount = cached.length;
      setBadge();
      renderAvailable(cached);
    }
    if (campaignsBusy || !configured) {
      if (!configured && uiAvailableEl) renderAvailable([]);
      return Promise.resolve();
    }
    campaignsBusy = true;
    if (uiAvailableEl && !cached) {
      var loading = document.createElement('div');
      loading.style.cssText = 'color:' + T.text3 + ';padding:4px 0;font-size:12px';
      loading.textContent = 'Loading giveaways…';
      uiAvailableEl.textContent = '';
      uiAvailableEl.appendChild(loading);
    }
    return fetch(CAMPAIGNS_ENDPOINT).then(function (response) {
      return response.json();
    }).then(function (payload) {
      var actions = payload && Array.isArray(payload.claimActions) ? payload.claimActions : [];
      availableCount = actions.length;
      setBadge();
      renderAvailable(actions);
      try { localStorage.setItem(CAMPAIGNS_CACHE_KEY, JSON.stringify({ at: Date.now(), claimActions: actions })); } catch (e) {}
      if (payload && payload.ok === false) {
        log('warn', 'campaigns fetch failed', payload.error || null);
      }
    }).catch(function (err) {
      if (uiAvailableEl) {
        var failed = document.createElement('div');
        failed.style.cssText = 'color:' + T.err + ';padding:4px 0;font-size:12px';
        failed.textContent = 'Could not load giveaways: ' + (err && err.message ? err.message : err);
        uiAvailableEl.textContent = '';
        uiAvailableEl.appendChild(failed);
      }
    }).then(function () {
      campaignsBusy = false;
    });
  }

  function refreshHistory() {
    if (!uiHistoryEl) return Promise.resolve();
    return fetch(HISTORY_ENDPOINT).then(function (response) {
      return response.json();
    }).then(function (payload) {
      var history = payload && Array.isArray(payload.history) ? payload.history : [];
      uiHistoryEl.textContent = '';
      var claims = history.filter(function (e) { return e.type === 'claim'; });
      if (!claims.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'color:' + T.text3 + ';padding:2px 0;font-size:12px';
        empty.textContent = 'Nothing claimed yet.';
        uiHistoryEl.appendChild(empty);
        return;
      }
      for (var i = 0; i < history.length && i < 12; i += 1) {
        var entry = history[i];
        if (entry.type === 'summary') {
          var sum = document.createElement('div');
          sum.style.cssText = 'color:' + T.text3 + ';font-size:11px;padding:3px 0;font-variant-numeric:tabular-nums';
          sum.textContent = 'Run: claimed ' + entry.claimedCount + ', failed ' + entry.failedCount + ' · ' + fmtTime(entry.ts);
          uiHistoryEl.appendChild(sum);
          continue;
        }
        var line = document.createElement('div');
        line.style.cssText = 'display:flex;align-items:baseline;gap:8px;padding:3px 0;font-size:12px';
        var color = entry.ok ? T.ok : (entry.status === 'skipped_captcha_required' ? T.warn : T.err);
        var st = document.createElement('span');
        st.style.cssText = 'display:flex;align-self:center;flex-shrink:0;color:' + color;
        st.innerHTML = icon(entry.ok ? 'check' : (entry.status === 'skipped_captcha_required' ? 'skip' : 'x'), 13);
        var plan = document.createElement('span');
        plan.style.cssText = 'font-family:' + T.mono + ';font-size:11px;color:' + T.text + ';flex-shrink:0';
        plan.textContent = entry.planId || '?';
        var msg = document.createElement('span');
        msg.style.cssText = 'color:' + T.text2 + ';min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        msg.textContent = entry.ok ? (entry.message || 'claimed') : (entry.message || entry.status || 'failed');
        var ts = document.createElement('span');
        ts.style.cssText = 'font-family:' + T.mono + ';font-size:10px;color:' + T.text3 + ';font-variant-numeric:tabular-nums;flex-shrink:0';
        ts.textContent = fmtTime(entry.ts);
        line.appendChild(st);
        line.appendChild(plan);
        line.appendChild(msg);
        line.appendChild(ts);
        uiHistoryEl.appendChild(line);
      }
    }).catch(function () {});
  }

  function updateLoginRow() {
    if (!uiLoginRow) return;
    var globalBtn = uiLoginRow.querySelector('#zcode-login-global');
    var cnBtn = uiLoginRow.querySelector('#zcode-login-cn');
    globalBtn.style.display = configured ? 'none' : '';
    cnBtn.style.display = configured ? 'none' : '';
  }

  // ---------- captcha ----------

  function ensureCaptchaMount() {
    if (document.getElementById('zcode-aliyun-captcha-container')) return;
    var host = document.createElement('div');
    host.id = 'zcode-aliyun-captcha-container';
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('style', 'position:fixed;left:0;top:0;z-index:2147483647;width:0;height:0;overflow:visible');
    host.innerHTML = '<div id="zcode-aliyun-captcha-element" style="position:absolute;left:0;top:0;width:0;height:0;overflow:visible"></div>' +
      '<button id="zcode-aliyun-captcha-button" type="button" tabindex="-1" aria-hidden="true" style="position:fixed;left:50%;top:50%;width:1px;height:1px;border:0;padding:0;transform:translate(-50%,-50%);opacity:0"></button>';
    (document.body || document.documentElement).appendChild(host);
  }

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
    ensureCaptchaMount();
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
        var button = document.getElementById('zcode-aliyun-captcha-button');
        var settled = false;
        var timer = null;
        var language = (document.documentElement.lang || navigator.language || 'en').toLowerCase().startsWith('zh') ? 'cn' : 'en';
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
            element: '#zcode-aliyun-captcha-element',
            button: '#zcode-aliyun-captcha-button',
            getInstance: function () {
              setLogin('Captcha ready — please complete the verification window.');
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
                setLogin('Please complete the verification puzzle in the window.');
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

  // ---------- claim flow ----------

  function announceClaimResult(data) {
    if (!data || typeof data !== 'object') return;
    if (data.captcha && data.captcha.required) {
      toast('Captcha required before claiming', 'warn');
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
    if (claimed.length) {
      toast('Token claimed: ' + claimed.join(', '), 'ok');
      log('info', 'claim succeeded', { plans: claimed });
    } else if (failed.length) {
      var reason = data.errors && data.errors[0] && data.errors[0].message;
      toast('Claim failed for ' + failed.join(', ') + (reason ? ': ' + reason : ''), 'error');
    } else if (data.ok === false && data.errors && data.errors.length) {
      toast('Claim failed: ' + data.errors[0].message, 'error');
    }
  }

  function runClaimWithCaptcha(planId) {
    if (claimBusy) {
      toast('Another claim is already in progress…', 'warn');
      return;
    }
    setLogin('Checking captcha requirement…');
    claimBusy = true;
    return fetch(CAPTCHA_CONFIG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (response) {
      return response.json();
    }).then(function (data) {
      var config = data.config || {};
      log('info', 'captcha config', { enabled: !!data.enabled, region: config.region || '', sceneId: config.sceneId || '' });
      if (data.enabled && config.region && config.prefix && config.sceneId) {
        setLogin('Captcha required — opening official verification window…');
        return solveCaptcha(config).then(function (solved) {
          log('info', 'captcha solved', { region: solved.captchaRegion });
          setLogin('Captcha solved — sending claim…');
          return claimAll(solved, planId);
        });
      }
      log('info', 'no captcha required');
      setLogin('No captcha required — sending claim…');
      return claimAll(undefined, planId);
    }).catch(function (err) {
      setLogin('Claim failed: ' + (err && err.message ? err.message : String(err)));
      toast('Claim failed: ' + (err && err.message ? err.message : err), 'error');
      render(findToken(), 'claim failed', String(err && err.message ? err.message : err));
    }).then(function () {
      claimBusy = false;
      fetchStatus();
      refreshHistory();
      refreshCampaigns(true);
    });
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
    autoClaimPending = true;
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
      toast('Popup blocked — allow popups for 127.0.0.1', 'error');
      return;
    }
    setLogin('Starting ' + provider + ' login…');
    log('info', 'login started', { provider: provider });
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
      log('info', 'oauth init ok', { provider: provider, flowId: flowId, intervalMs: interval });
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
          if (result.status !== lastPollStatus) {
            lastPollStatus = result.status;
            log('debug', 'oauth poll status', { status: result.status });
          }
          if (result.status === 'ready' && typeof result.token === 'string' && result.token.trim()) {
            log('info', 'oauth ready', {
              provider: provider,
              userId: result.user ? (result.user.user_id || result.user.id || '') : ''
            });
            clearInterval(loginTimer);
            loginTimer = null;
            storeToken(result.token.trim(), provider, result.user);
            setLogin('Logged in — JWT saved, sending to claim server…');
            toast('Signed in — JWT saved', 'ok');
            push(true);
          } else if (result.status === 'failed') {
            clearInterval(loginTimer);
            loginTimer = null;
            setLogin('Login failed — retry');
            toast('Login failed — please retry', 'error');
          }
        }).catch(function () {});
      }, interval);
    }).catch(function (err) {
      setLogin('OAuth init failed: ' + (err && err.message ? err.message : String(err)));
      toast('OAuth init failed: ' + (err && err.message ? err.message : err), 'error');
      try { popup.close(); } catch (e) {}
    });
  }

  function claimAll(captcha, planId) {
    ensureCaptchaMount();
    var body = captcha || {};
    if (planId) body.planId = planId;
    log('info', 'claim request', { captchaIncluded: !!captcha, planId: planId || null });
    return fetch(CLAIM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return { httpStatus: response.status }; });
    }).then(function (data) {
      log('info', 'claim response', data);
      render(findToken(), 'sent to claim server', data);
      announceClaimResult(data);
      return data;
    }).catch(function (err) {
      log('error', 'claim request failed', { message: String(err && err.message ? err.message : err) });
      toast('Claim request failed: ' + (err && err.message ? err.message : err), 'error');
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
    log('info', 'pushing JWT to claim server', { provider: found.provider, source: found.source });
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
        var wasConfigured = configured;
        seen = found.jwt;
        log('info', 'JWT configured on claim server', { prefix: found.jwt.slice(0, 12) });
        render(found, 'sent to claim server');
        configured = true;
        setBadge();
        updateLoginRow();
        if (!wasConfigured) refreshCampaigns(true);
        if (autoClaimPending && !autoClaimed) {
          autoClaimPending = false;
          autoClaimed = true;
          runClaimWithCaptcha();
        }
      } else {
        render(found, 'HTTP ' + response.status);
      }
    }).catch(function () {
      render(found, 'fetch blocked');
    });
  }

  // ---------- debug panel (zcodeDebug=1) ----------

  function debugPanel() {
    if (debugPanelEl || !document.body) return;
    debugPanelEl = document.createElement('div');
    debugPanelEl.id = 'zcode-claim-widget';
    debugPanelEl.setAttribute('style', 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;background:' + T.bg + ';color:' + T.text + ';border:1px solid ' + T.borderStrong + ';border-radius:12px;padding:14px;max-width:460px;box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px ' + T.font);
    debugPanelEl.innerHTML = '<div style="font-weight:600;margin-bottom:8px">ZCode giveaway — debug</div>' +
      '<div id="zcode-claim-status" style="margin-bottom:8px">checking…</div>' +
      '<div id="zcode-claim-login" style="margin-bottom:8px;color:#a7f3d0">not logged in</div>' +
      '<pre id="zcode-claim-result" style="white-space:pre-wrap;word-break:break-all;max-height:160px;overflow:auto;background:' + T.surface + ';padding:8px;border-radius:8px;font-size:11px;font-family:' + T.mono + '"></pre>' +
      '<pre id="zcode-claim-keys" style="white-space:pre-wrap;word-break:break-all;max-height:100px;overflow:auto;background:' + T.surface + ';padding:8px;border-radius:8px;font-size:10px;opacity:.75;font-family:' + T.mono + '"></pre>' +
      '<button id="zcode-claim-dbg-close" style="background:' + T.surface + ';color:' + T.text + ';border:1px solid ' + T.borderStrong + ';border-radius:8px;padding:7px 10px">Close debug</button>';
    document.body.appendChild(debugPanelEl);
    statusEl = debugPanelEl.querySelector('#zcode-claim-status');
    keysEl = debugPanelEl.querySelector('#zcode-claim-keys');
    resultEl = debugPanelEl.querySelector('#zcode-claim-result');
    loginEl = debugPanelEl.querySelector('#zcode-claim-login');
    debugPanelEl.querySelector('#zcode-claim-dbg-close').onclick = function () {
      if (debugPanelEl && debugPanelEl.parentNode) debugPanelEl.parentNode.removeChild(debugPanelEl);
      debugPanelEl = null;
      statusEl = null;
      keysEl = null;
      resultEl = null;
      loginEl = null;
    };
    log('info', 'debug panel opened', { debug: DEBUG, url: window.location.href });
  }

  // ---------- tokens widget ----------

  function widget() {
    if (pill || !document.body) return;

    pill = document.createElement('div');
    pill.id = 'zcode-claim-pill';
    pill.setAttribute('style', 'position:fixed;right:14px;bottom:14px;z-index:2147483646;' +
      'display:flex;align-items:center;gap:7px;background:' + T.bg + ';color:' + T.text + ';' +
      'border:1px solid ' + T.border + ';border-radius:999px;padding:8px 13px;cursor:pointer;user-select:none;' +
      'font:13px ' + T.font + ';box-shadow:0 6px 20px rgba(0,0,0,.45)');
    pill.innerHTML = '<span style="display:flex;color:' + T.text + '">' + icon('coin', 15) + '</span>' +
      '<span id="zcode-claim-pill-badge" style="font-weight:600;min-width:10px;font-variant-numeric:tabular-nums"></span>' +
      '<span id="zcode-claim-pill-dot" style="width:7px;height:7px;border-radius:50%;background:' + T.text3 + '"></span>';
    pill.title = 'ZCode promo tokens';
    pillBadge = pill.querySelector('#zcode-claim-pill-badge');
    pillDot = pill.querySelector('#zcode-claim-pill-dot');
    pill.onclick = function () {
      if (panel && panel.style.display !== 'none') {
        panel.style.display = 'none';
        return;
      }
      if (panel) panel.style.display = '';
      if (panel && !panel.parentNode) document.body.appendChild(panel);
      openPanel();
    };
    document.body.appendChild(pill);

    panel = document.createElement('div');
    panel.id = 'zcode-claim-panel';
    panel.setAttribute('style', 'position:fixed;right:14px;bottom:56px;z-index:2147483646;display:none;' +
      'width:330px;max-width:calc(100vw - 28px);max-height:min(600px,75vh);overflow:auto;' +
      'background:' + T.bg + ';color:' + T.text + ';border:1px solid ' + T.border + ';border-radius:12px;' +
      'padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px ' + T.font);
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="font-weight:600">Promo tokens</div>' +
        '<div id="zcode-claim-close" role="button" aria-label="Close" style="cursor:pointer;opacity:.7;padding:2px;display:flex">' + icon('close', 14) + '</div>' +
      '</div>' +
      '<div id="zcode-claim-ui-status" style="margin-bottom:8px;color:' + T.text2 + ';word-break:break-word">checking…</div>' +
      '<div id="zcode-claim-login-row" style="margin-bottom:10px">' +
        '<button id="zcode-login-global" style="display:inline-flex;align-items:center;gap:6px;background:' + T.accent + ';color:#fff;border:0;border-radius:8px;padding:7px 11px;margin-right:6px;cursor:pointer;font:12px ' + T.font + '">' + icon('arrow', 12) + '<span>Login · Global</span></button>' +
        '<button id="zcode-login-cn" style="display:inline-flex;align-items:center;gap:6px;background:' + T.surface + ';color:' + T.text + ';border:1px solid ' + T.borderStrong + ';border-radius:8px;padding:7px 11px;cursor:pointer;font:12px ' + T.font + '">' + icon('arrow', 12) + '<span>Login · CN</span></button>' +
      '</div>' +
      '<div style="margin-bottom:10px">' +
        '<button id="zcode-claim-now" style="display:inline-flex;align-items:center;gap:6px;background:' + T.accent + ';color:#fff;border:0;border-radius:8px;padding:7px 11px;margin-right:6px;cursor:pointer;font:12px ' + T.font + '">' + icon('zap', 12) + '<span>Claim all</span></button>' +
        '<button id="zcode-claim-refresh" style="display:inline-flex;align-items:center;gap:6px;background:transparent;color:' + T.text2 + ';border:1px solid ' + T.border + ';border-radius:8px;padding:7px 11px;margin-right:6px;cursor:pointer;font:12px ' + T.font + '">' + icon('refresh', 12) + '<span>Refresh</span></button>' +
        '<button id="zcode-claim-open" style="display:inline-flex;align-items:center;gap:6px;background:transparent;color:' + T.text2 + ';border:1px solid ' + T.border + ';border-radius:8px;padding:7px 11px;cursor:pointer;font:12px ' + T.font + '">' + icon('coin', 12) + '<span>Claim page</span></button>' +
      '</div>' +
      '<div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + T.text3 + ';margin-bottom:4px">Available</div>' +
      '<div id="zcode-claim-available" style="margin-bottom:10px"></div>' +
      '<div style="font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:' + T.text3 + ';margin-bottom:4px">Received</div>' +
      '<div id="zcode-claim-history" style="margin-bottom:8px"></div>' +
      '<pre id="zcode-claim-ui-result" style="display:none;white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto;background:' + T.surface + ';padding:8px;border-radius:8px;font-size:11px;font-family:' + T.mono + ';color:' + T.text2 + ';border:1px solid ' + T.border + '"></pre>' +
      (DEBUG ? '<div id="zcode-claim-debug-link" style="cursor:pointer;color:' + T.accent + ';font-size:11px;margin-top:6px">Open debug panel</div>' : '');
    document.body.appendChild(panel);
    uiStatusEl = panel.querySelector('#zcode-claim-ui-status');
    uiLoginRow = panel.querySelector('#zcode-claim-login-row');
    uiAvailableEl = panel.querySelector('#zcode-claim-available');
    uiHistoryEl = panel.querySelector('#zcode-claim-history');
    uiResultEl = panel.querySelector('#zcode-claim-ui-result');
    panel.querySelector('#zcode-claim-close').onclick = function () {
      panel.style.display = 'none';
    };
    uiLoginRow.querySelector('#zcode-login-global').onclick = function () { startLogin('zai'); };
    uiLoginRow.querySelector('#zcode-login-cn').onclick = function () { startLogin('zai_cn'); };
    panel.querySelector('#zcode-claim-now').onclick = function () { runClaimWithCaptcha(); };
    panel.querySelector('#zcode-claim-refresh').onclick = function () {
      fetchStatus();
      refreshCampaigns(true);
      refreshHistory();
    };
    panel.querySelector('#zcode-claim-open').onclick = function () {
      window.open(CLAIM_BASE + '/claim', '_blank');
    };
    var debugLink = panel.querySelector('#zcode-claim-debug-link');
    if (debugLink) debugLink.onclick = function () { debugPanel(); };

    log('info', 'claim widget ready', { debug: DEBUG, url: window.location.href });
    fetchStatus();
  }

  function openPanel() {
    if (!panel) return;
    fetchStatus();
    refreshCampaigns(false);
    refreshHistory();
  }

  window.addEventListener('zcode-browser-auth-change', function () { push(true); });
  window.addEventListener('storage', function (event) {
    if (!event.key || event.key.indexOf('oauth:') === 0 || /jwt|token/i.test(event.key)) push(true);
  });
  setInterval(function () { push(false); }, 2000);
  setInterval(function () { fetchStatus(); }, 4000);
  document.addEventListener('DOMContentLoaded', widget);
  if (document.body) widget();
  push(false);
})();
