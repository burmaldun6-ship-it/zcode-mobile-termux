'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const claimServer = require('../claim/claim-server.js');

// Isolated data dir so the suite never touches the real claim-state.json.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-claim-server-test-'));
process.env.ZCODE_DATA_BASE_DIR = path.join(dataDir, 'v2');

const deliveries = [
  {
    resource_position: 'banner',
    campaign_id: 'cmp-banner',
    priority: 10,
    banner: { buttons: [{ label: 'Claim', action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-A' } } }] },
  },
  {
    resource_position: 'popup',
    campaign_id: 'cmp-popup',
    priority: 7,
    popup: { buttons: [{ action: { type: 'claim_zcode_plan', args: { plan_id: 'plan-B' } } }] },
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

function createMockFetch(claimCodes) {
  let claimCall = 0;
  const calls = [];
  const mockFetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = { path: parsed.pathname, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (parsed.pathname === '/api/v1/marketing/touch') {
      return jsonResponse({ code: 0, data: { server_time: 1000, language: 'en-US', deliveries } });
    }
    if (parsed.pathname === '/api/v1/zcode-plan/billing/preview') {
      return jsonResponse({ code: 0, data: { plans: [{ planId: 'plan-A' }], server_time: 1001 } });
    }
    if (parsed.pathname === '/api/v1/client/configs') {
      return jsonResponse({ code: 0, data: { configs: { captcha: { enabled: false } } } });
    }
    if (parsed.pathname === '/api/v1/zcode-plan/billing/claim') {
      const code = claimCodes[Math.min(claimCall, claimCodes.length - 1)];
      claimCall += 1;
      const planId = call.body && call.body.plan_id;
      if (code === 0) {
        return jsonResponse({ code: 0, data: { plan: { id: planId }, server_time: 1002, message: 'ok' } });
      }
      return jsonResponse({ code, message: 'failure ' + code });
    }
    if (parsed.pathname === '/api/v1/marketing/touch/action') {
      return jsonResponse({ code: 0 });
    }
    throw new Error('no mock handler for ' + init.method + ' ' + parsed.pathname);
  };
  mockFetch.calls = calls;
  return mockFetch;
}

async function main() {
  let passed = 0;
  let failed = 0;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const server = claimServer.startServer({ port: 0 });

  test('GET /claim/status exposes state without the JWT', async () => {
    const s = await server;
    const port = s.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/claim/status');
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.state.configured, false);
    assert.ok(!JSON.stringify(payload).includes('secret-jwt-value'));
  });

  test('POST /claim/auto-token stores the JWT', async () => {
    const s = await server;
    const port = s.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/claim/auto-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: 'secret-jwt-value' }),
    });
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.state.configured, true);
    const status = await (await fetch('http://127.0.0.1:' + port + '/claim/status')).json();
    assert.equal(status.state.configured, true);
    assert.ok(!JSON.stringify(status).includes('secret-jwt-value'));
  });

  test('runClaimAll records history and human-readable claims.log', async () => {
    const fetchImpl = createMockFetch([0, 0]);
    const result = await claimServer.runClaimAll({}, { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.claimedCount, 2);

    const state = claimServer.loadState();
    assert.ok(Array.isArray(state.history));
    const summary = state.history.find((e) => e.type === 'summary');
    assert.ok(summary, 'summary entry recorded');
    assert.equal(summary.claimedCount, 2);
    const claimEntries = state.history.filter((e) => e.type === 'claim');
    assert.deepEqual(claimEntries.map((e) => e.planId).sort(), ['plan-A', 'plan-B']);
    assert.ok(claimEntries.every((e) => e.ok === true));
    assert.ok(!JSON.stringify(state.history).includes('secret-jwt-value'));

    const logFile = claimServer.getClaimsLogPath();
    const logText = fs.readFileSync(logFile, 'utf8');
    assert.match(logText, /CLAIM OK +plan=plan-A/);
    assert.match(logText, /CLAIM OK +plan=plan-B/);
    assert.match(logText, /RUN SUMMARY claimed=2 failed=0/);
    assert.ok(!logText.includes('secret-jwt-value'));
  });

  test('GET /claim/history returns recorded entries', async () => {
    const s = await server;
    const port = s.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/claim/history');
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.history.length >= 3);
    assert.ok(payload.history.some((e) => e.type === 'summary'));
    assert.ok(!JSON.stringify(payload).includes('secret-jwt-value'));
  });

  test('onlyPlanId restricts the claim run to one plan', async () => {
    const fetchImpl = createMockFetch([0]);
    const result = await claimServer.runClaimAll({ planId: 'plan-B' }, { fetchImpl });
    assert.equal(result.claimedCount, 1);
    assert.deepEqual(result.actions.map((a) => a.planId), ['plan-B']);
    const claimCalls = fetchImpl.calls.filter((c) => c.path === '/api/v1/zcode-plan/billing/claim');
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0].body.plan_id, 'plan-B');
  });

  test('failed claim codes are recorded as CLAIM FAIL', async () => {
    const fetchImpl = createMockFetch([1003]);
    const result = await claimServer.runClaimAll({ planId: 'plan-A' }, { fetchImpl });
    assert.equal(result.claimedCount, 0);
    const state = claimServer.loadState();
    const entry = state.history.find((e) => e.type === 'claim' && e.planId === 'plan-A' && e.ok === false);
    assert.ok(entry, 'failure entry recorded');
    assert.equal(entry.code, 1003);
    const logText = fs.readFileSync(claimServer.getClaimsLogPath(), 'utf8');
    assert.match(logText, /CLAIM FAIL plan=plan-A campaign=cmp-banner code=1003/);
  });

  test('unknown route returns 404', async () => {
    const s = await server;
    const port = s.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/claim/nope');
    assert.equal(response.status, 404);
  });

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

  const s = await server;
  await new Promise((resolve) => s.close(resolve));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
}

main();
