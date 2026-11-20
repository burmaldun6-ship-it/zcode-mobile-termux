'use strict';

const assert = require('node:assert/strict');
const claim = require('./claim');
const oauth = require('./oauth-helper');

const deliveries = [
  {
    resource_position: 'banner',
    campaign_id: 'cmp-banner',
    priority: 10,
    banner: {
      buttons: [
        { label: 'Claim', action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-A' } } },
        { label: 'More', action: { type: 'open_link', args: { url: 'https://example.com' } } },
      ],
    },
  },
  {
    resource_position: 'banner',
    campaign_id: 'cmp-banner-duplicate',
    priority: 5,
    banner: { buttons: [{ action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-dup' } } }] },
  },
  {
    resource_position: 'popup',
    campaign_id: 'cmp-popup',
    priority: 7,
    popup: { buttons: [{ action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-B' } } }] },
  },
  {
    resource_position: 'popup',
    campaign_id: 'cmp-popup-duplicate',
    priority: 1,
    popup: { buttons: [{ action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-dup2' } } }] },
  },
];

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
    json: async () => value,
  };
}

function createMockFetch(handlers = {}) {
  const calls = [];
  const mockFetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method || 'GET';
    const call = {
      url: parsed.toString(),
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      method,
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : null,
      signal: init.signal,
    };
    calls.push(call);
    const handler = handlers[method + ' ' + parsed.pathname] || handlers.default;
    if (!handler) throw new Error('no mock handler for ' + method + ' ' + parsed.pathname);
    return handler(call);
  };
  mockFetch.calls = calls;
  return mockFetch;
}

function defaultHandlers(overrides = {}) {
  return {
    'GET /api/v1/marketing/touch': () => jsonResponse({
      code: 0,
      data: { server_time: 1000, language: 'zh-CN', deliveries },
    }),
    'GET /api/v1/zcode-plan/billing/preview': () => jsonResponse({
      code: 0,
      data: { plans: [{ planId: 'plan-A' }], server_time: 1001 },
    }),
    'GET /api/v1/client/configs': () => jsonResponse({
      code: 0,
      data: { configs: { captcha: { enabled: false } } },
    }),
    'POST /api/v1/zcode-plan/billing/claim': () => jsonResponse({
      code: 0,
      data: { plan: { id: 'plan-A' }, server_time: 1002, message: 'ok' },
    }),
    'POST /api/v1/marketing/touch/action': () => jsonResponse({ code: 0 }),
    'POST /api/v1/oauth/token': () => jsonResponse({
      code: 0,
      data: { token: 'jwt-123', expires_in: 3600 },
    }),
    ...overrides,
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('buildHeaders and buildUrl produce the full header set and encoded query', () => {
  const headers = claim.buildHeaders({
    jwt: 'jwt-x',
    deviceMid: 'dev-x',
    locale: 'en-US',
    platform: 'darwin-arm64',
    hasBody: true,
    extra: { 'X-Aliyun-Captcha-Verify-Param': 'param' },
  });
  assert.equal(headers['Authorization'], 'Bearer jwt-x');
  assert.equal(headers['X-ZCode-App-Version'], '3.18.2');
  assert.equal(headers['X-Platform'], 'darwin-arm64');
  assert.equal(headers['X-Device-Mid'], 'dev-x');
  assert.equal(headers['X-Client-Language'], 'en-US');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['X-Aliyun-Captcha-Verify-Param'], 'param');

  const url = claim.buildUrl('/api/v1/marketing/touch', { seq: 3, q: 'a b' });
  assert.equal(url, 'https://zcode.z.ai/api/v1/marketing/touch?seq=3&q=a+b');
});

test('getMarketingTouch sends seq, auth and device headers', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  const result = await claim.getMarketingTouch({
    jwt: 'jwt-x', deviceMid: 'dev-x', seq: 7, locale: 'en-US', platform: 'win32-x64', fetchImpl,
  });
  const call = fetchImpl.calls[0];
  assert.equal(call.method, 'GET');
  assert.equal(call.path, '/api/v1/marketing/touch');
  assert.deepEqual(call.query, { seq: '7' });
  assert.equal(call.headers['Authorization'], 'Bearer jwt-x');
  assert.equal(call.headers['X-Device-Mid'], 'dev-x');
  assert.equal(call.headers['X-Client-Language'], 'en-US');
  assert.equal(call.headers['X-Platform'], 'win32-x64');
  assert.equal(result.serverTime, 1000);
  assert.equal(result.language, 'zh-CN');
  assert.equal(result.deliveries.length, 4);
});

test('business code failures are normalized and thrown', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/marketing/touch': () => jsonResponse({ code: 4001, message: 'bad seq' }),
  }));
  await assert.rejects(
    () => claim.getMarketingTouch({ jwt: 'j', deviceMid: 'd', seq: 1, fetchImpl }),
    (err) => err instanceof claim.ZCodeError && err.code === 4001
  );
});

test('extractClaimActions keeps first valid delivery per resource_position', () => {
  const actions = claim.extractClaimActions(deliveries);
  assert.deepEqual(actions.map((a) => a.planId), ['plan-A', 'plan-B']);
  assert.deepEqual(actions.map((a) => a.campaignId), ['cmp-banner', 'cmp-popup']);
});

test('preview and captcha-config include app_version/platform and config is normalized', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  const previews = await claim.getClaimPreviews({ jwt: 'j', platform: 'darwin-arm64', fetchImpl });
  const config = await claim.getCaptchaConfig({ jwt: 'j', platform: 'darwin-arm64', fetchImpl });
  assert.deepEqual(fetchImpl.calls[0].query, { app_version: '3.18.2', platform: 'darwin-arm64' });
  assert.deepEqual(fetchImpl.calls[1].query, { app_version: '3.18.2', platform: 'darwin-arm64' });
  assert.equal(previews.plans[0].planId, 'plan-A');
  assert.equal(config.enabled, false);
  assert.equal(config.config.enabled, false);
});

test('captcha config is disabled when fields are missing even if enabled=true', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/client/configs': () => jsonResponse({ code: 0, data: { configs: { captcha: { enabled: true } } } }),
  }));
  const config = await claim.getCaptchaConfig({ jwt: 'j', fetchImpl });
  assert.equal(config.config.enabled, true);
  assert.equal(config.enabled, false);
});

test('claimPlan uses plan_id body and numeric-string codes; terminal codes flagged', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'POST /api/v1/zcode-plan/billing/claim': () => jsonResponse({ code: '0', data: { plan: { id: 'plan-A' }, message: 'ok' } }),
  }));
  const ok = await claim.claimPlan({ jwt: 'j', deviceMid: 'd', planId: 'plan-A', fetchImpl });
  assert.equal(ok.success, true);
  assert.equal(ok.code, 0);
  assert.deepEqual(fetchImpl.calls[0].body, { plan_id: 'plan-A' });
  assert.equal(fetchImpl.calls[0].headers['X-Aliyun-Captcha-Verify-Param'], undefined);

  const failingFetch = createMockFetch(defaultHandlers({
    'POST /api/v1/zcode-plan/billing/claim': () => jsonResponse({ code: '1003', message: 'terminal' }),
  }));
  const failed = await claim.claimPlan({ jwt: 'j', planId: 'plan-A', fetchImpl: failingFetch });
  assert.equal(failed.success, false);
  assert.equal(failed.code, 1003);
  assert.equal(failed.terminal, true);
});

test('claimPlan forwards captcha headers when supplied', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  await claim.claimPlan({
    jwt: 'j', planId: 'plan-A', fetchImpl,
    captchaVerifyParam: 'verify-param', captchaRegion: 'cn-shanghai',
  });
  assert.equal(fetchImpl.calls[0].headers['X-Aliyun-Captcha-Verify-Param'], 'verify-param');
  assert.equal(fetchImpl.calls[0].headers['X-Aliyun-Captcha-Verify-Region'], 'cn-shanghai');
});

test('reportTouchAction sends campaign_id/action_type and validates actionType', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  const result = await claim.reportTouchAction({
    jwt: 'j', deviceMid: 'd', campaignId: 'cmp-1', actionType: 'confirm', fetchImpl,
  });
  assert.equal(result.success, true);
  assert.deepEqual(fetchImpl.calls[0].body, { campaign_id: 'cmp-1', action_type: 'confirm' });
  await assert.rejects(() => claim.reportTouchAction({ jwt: 'j', campaignId: 'c', actionType: 'nope', fetchImpl }));
});

test('verifyClaim re-queries touch and preview', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  const result = await claim.verifyClaim({ jwt: 'j', deviceMid: 'd', fetchImpl });
  assert.equal(result.verified, false);
  assert.equal(result.remainingClaimActions.length, 2);
  assert.equal(result.plans.length, 1);
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/v1/marketing/touch').length, 1);
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/v1/zcode-plan/billing/preview').length, 1);
});

test('claimAll without captcha claims, confirms and verifies', async () => {
  const fetchImpl = createMockFetch(defaultHandlers());
  const result = await claim.claimAll({ jwt: 'j', deviceMid: 'd', fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.captcha.enabled, false);
  assert.equal(result.claimedCount, 2);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.actions.map((a) => a.status), ['claimed', 'claimed']);
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/v1/zcode-plan/billing/claim').length, 2);
  const reports = fetchImpl.calls.filter((c) => c.path === '/api/v1/marketing/touch/action');
  assert.equal(reports.length, 2);
  assert.deepEqual(reports.map((c) => c.body.campaign_id), ['cmp-banner', 'cmp-popup']);
  assert.ok(result.verification);
});

test('claimAll with enabled captcha and no provider skips claims', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/client/configs': () => jsonResponse({
      code: 0,
      data: { configs: { captcha: { enabled: true, region: 'cn-shanghai', prefix: 'x', sceneId: 'scene-1' } } },
    }),
  }));
  const result = await claim.claimAll({ jwt: 'j', deviceMid: 'd', fetchImpl });
  assert.equal(result.captcha.required, true);
  assert.equal(result.captcha.enabled, true);
  assert.equal(result.ok, false);
  assert.deepEqual(result.actions.map((a) => a.status), [
    'skipped_captcha_required', 'skipped_captcha_required',
  ]);
  assert.equal(fetchImpl.calls.filter((c) => c.path === '/api/v1/zcode-plan/billing/claim').length, 0);
});

test('claimAll with enabled captcha uses provider verify param', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/client/configs': () => jsonResponse({
      code: 0,
      data: { configs: { captcha: { enabled: true, region: 'cn-shanghai', prefix: 'x', sceneId: 'scene-1' } } },
    }),
  }));
  let providerCalls = 0;
  const result = await claim.claimAll({
    jwt: 'j', deviceMid: 'd', fetchImpl,
    captchaProvider: async ({ sceneId, planId }) => {
      providerCalls++;
      assert.equal(sceneId, 'scene-1');
      return { verifyParam: 'solved-' + planId, region: 'cn-shanghai' };
    },
  });
  assert.equal(providerCalls, 2);
  assert.equal(result.ok, true);
  const claimCalls = fetchImpl.calls.filter((c) => c.path === '/api/v1/zcode-plan/billing/claim');
  assert.equal(claimCalls[0].headers['X-Aliyun-Captcha-Verify-Param'], 'solved-plan-A');
  assert.equal(claimCalls[0].headers['X-Aliyun-Captcha-Verify-Region'], 'cn-shanghai');
});

test('claimAll stops cleanly when marketing touch fails', async () => {
  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/marketing/touch': () => jsonResponse({ code: 5001 }),
  }));
  const result = await claim.claimAll({ jwt: 'j', deviceMid: 'd', fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].stage, 'marketing-touch');
  assert.equal(result.actions.length, 0);
});

test('requestJson times out and normalizes HTTP errors', async () => {
  const timeoutFetch = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(
    () => claim.requestJson({ path: '/api/v1/client/configs', fetchImpl: timeoutFetch, timeoutMs: 20 }),
    (err) => err.name === 'TimeoutError'
  );

  const fetchImpl = createMockFetch(defaultHandlers({
    'GET /api/v1/client/configs': () => jsonResponse({ code: 0 }, 500),
  }));
  await assert.rejects(
    () => claim.requestJson({ path: '/api/v1/client/configs', fetchImpl }),
    (err) => err.name === 'HttpError' && err.httpStatus === 500
  );
});

test('OAuth authorize URL, callback parsing and token exchange', async () => {
  const state = oauth.createOAuthState();
  const url = oauth.buildAuthorizeUrl({ state });
  const parsedUrl = new URL(url);
  assert.equal(parsedUrl.origin + parsedUrl.pathname, 'https://chat.z.ai/api/oauth/authorize');
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('client_id'), oauth.CLIENT_ID);
  assert.equal(parsedUrl.searchParams.get('state'), state);
  assert.equal(
    parsedUrl.searchParams.get('redirect_uri'),
    'https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback&app_version=3.18.2'
  );

  const native = oauth.parseCallbackUrl('zcode://oauth/callback?code=abc&state=' + state);
  assert.equal(native.code, 'abc');
  assert.equal(native.state, state);
  assert.equal(oauth.verifyCallbackState(native, state), true);
  assert.equal(oauth.verifyCallbackState(native, 'other'), false);
  assert.throws(() => oauth.assertCallbackState(native, 'other'), /state mismatch/i);

  const web = oauth.parseCallbackUrl(
    'https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback&app_version=3.18.2&code=xyz&state=' + state
  );
  assert.equal(web.code, 'xyz');
  assert.equal(web.state, state);

  const fetchImpl = createMockFetch(defaultHandlers());
  const token = await claim.loginWithAuthorizationCode({
    code: 'xyz', state, redirectUri: oauth.DEFAULT_REDIRECT_URI, fetchImpl,
  });
  assert.equal(token.success, true);
  assert.equal(token.token, 'jwt-123');
  assert.deepEqual(fetchImpl.calls[0].body, {
    provider: 'zai', code: 'xyz', redirect_uri: oauth.DEFAULT_REDIRECT_URI, state,
  });
  assert.equal(fetchImpl.calls[0].headers['X-ZCode-App-Version'], '3.18.2');
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log('PASS ' + t.name);
    } catch (err) {
      failed++;
      console.error('FAIL ' + t.name + '\n' + (err && err.stack ? err.stack : err));
    }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})();
