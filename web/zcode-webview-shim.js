(function () {
  'use strict';

  var CONFIG = { databaseStartupId: null, deviceId: null, hostId: null };
  var bridge = window.Android || window.AndroidBridge || null;
  var servicePort = null;
  var oauthCallbacks = [];

  function callBridge(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      if (bridge && typeof bridge[name] === 'function') return bridge[name].apply(bridge, args);
    } catch (e) {}
    return undefined;
  }

  function rpc(method, params) {
    return fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method, params: params || {} })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    });
  }

  function claimRequest(path, options) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {}))
      .then(function (r) { return r.json(); });
  }

  var claimApi = {
    status: function () { return claimRequest('/claim/status'); },
    campaigns: function () { return claimRequest('/claim/campaigns'); },
    start: function (jwt) {
      return claimRequest('/claim/start', {
        method: 'POST',
        body: JSON.stringify({ jwt: jwt, deviceMid: CONFIG.deviceId || callBridge('getDeviceMid') })
      });
    },
    claimAll: function () { return claimRequest('/claim/claim-all', { method: 'POST', body: '{}' }); },
    report: function (campaignId, actionType) {
      return claimRequest('/claim/report', {
        method: 'POST',
        body: JSON.stringify({ campaignId: campaignId, actionType: actionType || 'confirm' })
      });
    },
    claimPlan: function (planId) {
      return claimRequest('/claim', {
        method: 'POST',
        body: JSON.stringify({
          planId: planId,
          deviceMid: CONFIG.deviceId || callBridge('getDeviceMid'),
          token: callBridge('getToken') || undefined
        })
      });
    }
  };

  function WebPort(ws) {
    this.ws = ws;
    this._listeners = {};
    this.onmessage = null;
    this.onopen = null;
    this.onclose = null;
    this.readyState = 0;
    var self = this;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', function () {
      self.readyState = 1;
      if (self.onopen) self.onopen({ target: self });
    });
    ws.addEventListener('message', function (e) {
      var data = e.data;
      if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
        try { data = new TextEncoder().encode(String(data)).buffer; } catch (_) { return; }
      }
      var bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      var ev = { data: bytes, ports: [], target: self };
      if (self.onmessage) self.onmessage(ev);
      (self._listeners.message || []).slice().forEach(function (fn) { fn(ev); });
    });
    ws.addEventListener('close', function () {
      self.readyState = 3;
      if (self.onclose) self.onclose({ target: self });
    });
  }
  WebPort.prototype.postMessage = function (data) {
    if (this.ws.readyState !== 1) return;
    var bytes;
    if (data instanceof ArrayBuffer) bytes = data;
    else if (ArrayBuffer.isView(data)) bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    else if (typeof data === 'string') bytes = new TextEncoder().encode(data).buffer;
    else bytes = new TextEncoder().encode(JSON.stringify(data)).buffer;
    try { this.ws.send(bytes); } catch (e) {}
  };
  WebPort.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  WebPort.prototype.removeEventListener = function (type, fn) {
    var list = this._listeners[type] || [];
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  WebPort.prototype.start = function () {};
  WebPort.prototype.close = function () { try { this.ws.close(); } catch (e) {} };

  function connectServicePort() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(proto + '//' + location.host + '/zcode-service-port');
    servicePort = new WebPort(ws);
    ws.addEventListener('open', function () {
      var ev = new Event('message');
      Object.defineProperty(ev, 'data', { value: {
        type: 'zcode:service-port',
        databaseStartupId: CONFIG.databaseStartupId,
        hostId: CONFIG.hostId
      } });
      Object.defineProperty(ev, 'ports', { value: [servicePort] });
      Object.defineProperty(ev, 'source', { value: window });
      window.dispatchEvent(ev);
    });
  }

  var SYNC_VALUES = {
    getDeviceId: function () { return CONFIG.deviceId || callBridge('getDeviceMid') || 'android-device'; },
    getSystemLocale: function () { return 'en-US'; },
    getDesktopWindowChromeState: function () { return { maximized: false, fullscreen: false }; },
    getWindowControlsOverlayMetrics: function () { return { width: 0, height: 0, left: 0, right: 0 }; },
    getDesktopZoomLevel: function () { return 0; },
    getUpdateState: function () { return { status: 'idle', version: '3.18.2' }; },
    getApplicationLocale: function () { return 'en-US'; },
    canOpenCommunity: function () { return false; }
  };

  var zcode = new Proxy({}, {
    get: function (target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      if (SYNC_VALUES[prop]) return SYNC_VALUES[prop];
      if (prop === 'log') return function () {};
      if (prop === 'claim') return claimApi;
      if (prop === 'claimPlan') return function (planId) { return claimApi.claimPlan(planId); };
      if (prop === 'openExternal') return function (url) { return callBridge('openExternal', String(url)); };
      if (prop === 'registerOAuthState') return function (p) { window.__zcodeOAuthState = p; return Promise.resolve(); };
      if (prop === 'onOAuthCallback') return function (cb) {
        oauthCallbacks.push(cb);
        window.__zcodeOAuthCallback = function (payload) {
          oauthCallbacks.slice().forEach(function (f) { try { f(payload); } catch (e) {} });
        };
        return function () {};
      };
      if (prop === 'notifyRendererReady') return function () { return Promise.resolve(); };
      if (/^on[A-Z]/.test(prop) || /^add[A-Z]/.test(prop) || prop.indexOf('subscribe') === 0) {
        return function () { return function () {}; };
      }
      if (/^select(File|Files|Directory|Directories)$/.test(prop) || prop === 'saveFile' || prop === 'getPathForFile') {
        return function () { return Promise.resolve(''); };
      }
      if (/^get/.test(prop)) return function () { return Promise.resolve(null); };
      return function () { return rpc('zcode.desktop.' + prop, Array.prototype.slice.call(arguments)); };
    },
    has: function () { return true; },
    ownKeys: function () { return Object.keys(SYNC_VALUES); },
    getOwnPropertyDescriptor: function () { return { configurable: true, enumerable: true, value: undefined }; }
  });

  try { Object.defineProperty(window, 'zcode', { value: zcode, configurable: true }); } catch (e) { window.zcode = zcode; }
  window.zcodePluginSandbox = {
    supportsRetainedMove: function () { return false; },
    setExecutionActive: function () {}, copyImage: function () {},
    getOwnerWebContentsId: function () { return 0; },
    disposeSandbox: function () {}, consumeUserGesture: function () {}
  };
  window.__ZCODE_DEVICE_ID__ = CONFIG.deviceId || 'android-device';

  window.addEventListener('message', function (e) {
    if (e.data && typeof e.data === 'object' && e.data.type === 'zcode:oauth-callback') {
      if (window.__zcodeOAuthCallback) window.__zcodeOAuthCallback(e.data);
    }
  });

  function postStartupState(state) {
    if (!state) return;
    window.postMessage({ type: 'zcode:database-startup-state', state: state }, '*');
  }

  var lastStartupJson = '';
  function pollStartup() {
    return fetch('/health').then(function (r) { return r.json(); }).then(function (j) {
      var s = j && j.startup;
      if (s) {
        var serialized = JSON.stringify(s);
        if (serialized !== lastStartupJson) {
          lastStartupJson = serialized;
          postStartupState(s);
        }
      }
      if (!s || s.phase !== 'ready') setTimeout(pollStartup, 400);
    }).catch(function () { setTimeout(pollStartup, 1000); });
  }

  function addClaimButton() {
    if (document.getElementById('zcode-claim-panel')) return;
    var panel = document.createElement('div');
    panel.id = 'zcode-claim-panel';
    panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#171a21f2;border:1px solid #3b3f4a;border-radius:10px;padding:10px;width:270px;font:13px sans-serif;color:#eee;box-shadow:0 2px 12px #000a;';
    panel.innerHTML = '<div style="font-weight:bold;margin-bottom:6px">ZCode claim</div>' +
      '<input id="zcode-jwt" type="password" placeholder="zcode JWT" style="width:100%;box-sizing:border-box;background:#232733;color:#eee;border:1px solid #444;border-radius:6px;padding:6px;display:none">' +
      '<button id="zcode-claim-go" style="background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:7px 10px;cursor:pointer">Claim reward</button> ' +
      '<button id="zcode-claim-save" style="background:#3b3f4a;color:#fff;border:0;border-radius:6px;padding:7px 10px;cursor:pointer;display:none">Save JWT</button>' +
      '<pre id="zcode-claim-result" style="white-space:pre-wrap;word-break:break-all;max-height:140px;overflow:auto;font-size:11px"></pre>';
    (document.body || document.documentElement).appendChild(panel);
    var input = panel.querySelector('#zcode-jwt');
    var save = panel.querySelector('#zcode-claim-save');
    var result = panel.querySelector('#zcode-claim-result');
    var go = panel.querySelector('#zcode-claim-go');
    var cached = '';
    try { cached = localStorage.getItem('zcodejwttoken') || ''; } catch (_) {}
    if (cached) input.value = cached;
    function show(x) { result.textContent = typeof x === 'string' ? x : JSON.stringify(x, null, 2); }
    save.addEventListener('click', function () {
      var jwt = input.value.trim();
      if (!jwt) { show('enter JWT'); return; }
      try { localStorage.setItem('zcodejwttoken', jwt); } catch (_) {}
      claimApi.start(jwt).then(show).catch(function (e) { show(String(e && e.message || e)); });
    });
    go.addEventListener('click', function () {
      var jwt = input.value.trim();
      if (jwt && !cached) {
        try { localStorage.setItem('zcodejwttoken', jwt); } catch (_) {}
        claimApi.start(jwt).then(runClaim).catch(function (e) { show(String(e && e.message || e)); });
      } else {
        runClaim();
      }
    });
    function runClaim() {
      go.disabled = true;
      show('claiming...');
      claimApi.claimAll().then(function (r) {
        show(r && r.ok === false ? 'Failed: ' + JSON.stringify(r.error || r) : r);
      }).catch(function (e) {
        show('Error: ' + String(e && e.message || e));
      }).then(function () { go.disabled = false; });
    }
    claimApi.status().then(function (r) {
      if (r && r.state && !r.state.configured) {
        input.style.display = 'block';
        save.style.display = 'inline-block';
      }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addClaimButton);
  } else {
    addClaimButton();
  }

  pollStartup();

  fetch('/zcode-config').then(function (r) { return r.json(); }).then(function (c) {
    CONFIG = Object.assign(CONFIG, c);
    window.__ZCODE_DEVICE_ID__ = CONFIG.deviceId || 'android-device';
    connectServicePort();
    try {
      var token = callBridge('getToken');
      if (token) claimApi.start(token).catch(function () {});
    } catch (_) {}
  }).catch(function () { connectServicePort(); });
})();
