(function () {
  var TARGET = 'http://127.0.0.1:45212/claim/auto-token';
  var seen = null;

  function readToken() {
    try {
      var raw = localStorage.getItem('oauth:browser_session');
      if (raw) {
        var session = JSON.parse(raw);
        if (session && session.version === 1 && typeof session.zcodeJwtToken === 'string' && session.zcodeJwtToken.trim()) {
          return {
            jwt: session.zcodeJwtToken.trim(),
            provider: session.provider || '',
            locale: document.documentElement.lang || ''
          };
        }
      }
      var legacy = localStorage.getItem('zcodejwttoken');
      if (legacy && legacy.trim()) {
        return {
          jwt: legacy.trim(),
          provider: localStorage.getItem('oauth:active_provider') || '',
          locale: document.documentElement.lang || ''
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function push() {
    var value = readToken();
    if (!value || value.jwt === seen) return;
    fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    }).then(function (response) {
      if (response.ok) seen = value.jwt;
    }).catch(function () {});
  }

  window.addEventListener('zcode-browser-auth-change', push);
  window.addEventListener('storage', function (event) {
    if (!event.key || event.key.indexOf('oauth:') === 0 || event.key === 'zcodejwttoken') push();
  });
  setInterval(push, 2000);
  push();
})();
