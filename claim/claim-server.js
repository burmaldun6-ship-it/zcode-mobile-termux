'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const claim = require('./claim');
const oauth = require('./oauth-helper');

const DEFAULT_PORT = Number(process.env.ZCODE_CLAIM_PORT || 45210);
const DEFAULT_CALLBACK_PORT = Number(process.env.ZCODE_OAUTH_CALLBACK_PORT || 45211);
const MAX_BODY_BYTES = 1024 * 1024;

let externalCaptchaProvider = null;

function getStatePath() {
  const configured = process.env.ZCODE_DATA_BASE_DIR;
  if (configured) {
    return path.extname(configured).toLowerCase() === '.json'
      ? configured
      : path.join(configured, 'claim-state.json');
  }
  return path.join(os.homedir(), '.zcode', 'v2', 'claim-state.json');
}

function defaultState() {
  return {
    jwt: '',
    deviceMid: randomUUID(),
    seq: 1,
    locale: claim.DEFAULT_LOCALE,
    platform: claim.DEFAULT_PLATFORM,
    redirectUri: oauth.DEFAULT_REDIRECT_URI,
    pendingState: null,
    authorizeUrl: null,
    lastResult: null,
    updatedAt: null,
  };
}

function loadState() {
  const file = getStatePath();
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    stored = {};
  }
  const state = { ...defaultState(), ...(stored && typeof stored === 'object' ? stored : {}) };
  if (!state.deviceMid) state.deviceMid = randomUUID();
  if (!Number.isInteger(state.seq) || state.seq < 1) state.seq = 1;
  return state;
}

function saveState(patch = {}) {
  const current = loadState();
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const file = getStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return next;
}

function publicState(state) {
  return {
    configured: !!state.jwt,
    deviceMid: state.deviceMid,
    seq: state.seq,
    locale: state.locale,
    platform: state.platform,
    pendingState: state.pendingState,
    authorizeUrl: state.authorizeUrl,
    redirectUri: state.redirectUri,
    callbackPort: DEFAULT_CALLBACK_PORT,
    lastResult: state.lastResult,
    statePath: getStatePath(),
    updatedAt: state.updatedAt,
  };
}

function setCaptchaProvider(provider) {
  externalCaptchaProvider = typeof provider === 'function' ? provider : null;
}

function corsHeaders(req) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const origin = req.headers && req.headers.origin;
  if (origin && /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  return headers;
}

function sendJson(req, res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendText(req, res, statusCode, text, contentType) {
  const body = Buffer.from(text);
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'Content-Type': contentType,
    'Content-Length': body.length,
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error('request body too large');
      err.name = 'ValidationError';
      err.httpStatus = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be a JSON object');
    }
    return parsed;
  } catch (err) {
    err.name = 'ValidationError';
    err.httpStatus = 400;
    throw err;
  }
}

async function startOAuth({ redirectUri } = {}) {
  const state = randomUUID();
  const uri = redirectUri || loadState().redirectUri || oauth.DEFAULT_REDIRECT_URI;
  const authorizeUrl = oauth.buildAuthorizeUrl({ state, redirectUri: uri });
  saveState({ pendingState: state, authorizeUrl, redirectUri: uri });
  return {
    ok: true,
    state,
    redirectUri: uri,
    authorizeUrl,
    callbackPort: DEFAULT_CALLBACK_PORT,
    oauthCallbackPath: '/claim/oauth-callback',
  };
}

async function handleOAuthCallback({ url, code, state } = {}) {
  const current = loadState();
  let parsed = null;
  if (url) {
    parsed = oauth.parseCallbackUrl(url);
    if (parsed.error) {
      const err = new Error('OAuth provider returned error: ' + parsed.error + ' ' + (parsed.errorDescription || ''));
      err.name = 'OAuthError';
      err.httpStatus = 400;
      throw err;
    }
  }
  const resolvedCode = code || (parsed && parsed.code);
  const resolvedState = state || (parsed && parsed.state);
  if (!resolvedCode) {
    const err = new Error('missing authorization code');
    err.name = 'ValidationError';
    err.httpStatus = 400;
    throw err;
  }
  if (current.pendingState) {
    oauth.assertCallbackState({ state: resolvedState }, current.pendingState);
  }
  const token = await oauth.exchangeCodeForToken({
    code: resolvedCode,
    state: resolvedState,
    redirectUri: current.redirectUri,
    platform: current.platform,
    locale: current.locale,
  });
  if (!token.success || !token.token) {
    const err = new Error('token exchange failed: ' + (token.message || 'code ' + token.code));
    err.name = 'OAuthError';
    err.httpStatus = 502;
    err.code = token.code;
    throw err;
  }
  saveState({ jwt: token.token, pendingState: null, authorizeUrl: null });
  return { ok: true, configured: true, code: token.code };
}

function providerFromBody(body) {
  const verifyParam = body.captchaVerifyParam || body.captchaVerifyParamValue;
  if (!verifyParam) return externalCaptchaProvider;
  const region = body.captchaRegion || null;
  const once = async () => ({ verifyParam, region });
  return once;
}

async function runClaimAll(body) {
  const state = loadState();
  const overrides = {};
  for (const key of ['jwt', 'deviceMid', 'locale', 'platform']) {
    if (body[key] !== undefined) overrides[key] = body[key];
  }
  const effective = { ...state, ...overrides };
  const provider = providerFromBody(body);
  const result = await claim.claimAll({
    jwt: effective.jwt,
    deviceMid: effective.deviceMid,
    locale: effective.locale,
    platform: effective.platform,
    seq: state.seq,
    captchaProvider: provider || undefined,
  });
  saveState({
    seq: state.seq + 1,
    jwt: effective.jwt,
    deviceMid: effective.deviceMid,
    locale: effective.locale,
    platform: effective.platform,
    lastResult: {
      ok: result.ok,
      claimedCount: result.claimedCount,
      failedCount: result.failedCount,
      captchaRequired: result.captcha.required,
      errors: result.errors,
      finishedAt: new Date().toISOString(),
    },
  });
  return result;
}

async function routeRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const route = url.pathname;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (route === '/claim/status' && method === 'GET') {
    sendJson(req, res, 200, { ok: true, state: publicState(loadState()) });
    return;
  }

  if (route === '/claim/campaigns' && method === 'GET') {
    const state = loadState();
    const touch = await claim.getMarketingTouch({
      jwt: state.jwt,
      deviceMid: state.deviceMid,
      seq: state.seq,
      locale: state.locale,
      platform: state.platform,
    });
    saveState({ seq: state.seq + 1 });
    sendJson(req, res, 200, {
      ok: true,
      seqUsed: state.seq,
      serverTime: touch.serverTime,
      language: touch.language,
      deliveries: touch.deliveries,
      claimActions: claim.extractClaimActions(touch.deliveries),
    });
    return;
  }

  if (route === '/claim/start' && method === 'POST') {
    const body = await readJsonBody(req);
    const patch = {};
    for (const key of ['jwt', 'deviceMid', 'locale', 'platform', 'redirectUri']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.code || body.state || body.url) {
      const callback = await handleOAuthCallback({
        code: body.code,
        state: body.state,
        url: body.url,
      });
      Object.assign(patch, { jwt: loadState().jwt, pendingState: null });
      saveState(patch);
      sendJson(req, res, 200, { ok: true, mode: 'oauth', ...callback });
      return;
    }
    if (patch.jwt) {
      saveState(patch);
      sendJson(req, res, 200, { ok: true, mode: 'jwt', state: publicState(loadState()) });
      return;
    }
    const oauthFlow = await startOAuth({ redirectUri: patch.redirectUri });
    saveState(patch);
    sendJson(req, res, 200, { ok: true, mode: 'oauth-start', ...oauthFlow });
    return;
  }

  if (route === '/claim/oauth-callback' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await handleOAuthCallback({ url: body.url, code: body.code, state: body.state });
    sendJson(req, res, 200, { ok: true, ...result });
    return;
  }

  if (route === '/claim/claim-all' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await runClaimAll(body);
    sendJson(req, res, 200, result);
    return;
  }

  if (route === '/claim/report' && method === 'POST') {
    const body = await readJsonBody(req);
    const state = loadState();
    const result = await claim.reportTouchAction({
      jwt: body.jwt || state.jwt,
      deviceMid: body.deviceMid || state.deviceMid,
      locale: body.locale || state.locale,
      platform: body.platform || state.platform,
      campaignId: body.campaignId,
      actionType: body.actionType || 'confirm',
    });
    sendJson(req, res, 200, { ok: true, ...result });
    return;
  }

  sendJson(req, res, 404, { ok: false, error: { message: 'not found: ' + method + ' ' + route } });
}

function createServer() {
  return http.createServer((req, res) => {
    routeRequest(req, res).catch((err) => {
      const status = err.httpStatus || (err instanceof claim.ZCodeError ? 502 : 500);
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(req, res, status, { ok: false, error: claim.toErrorInfo(err, 'server') });
    });
  });
}

function startServer({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function startOAuthCallbackListener({ port = DEFAULT_CALLBACK_PORT, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let input = {};
      if (req.method === 'POST') {
        input = await readJsonBody(req);
      } else {
        input = {
          code: url.searchParams.get('code'),
          state: url.searchParams.get('state'),
          url: url.searchParams.get('url'),
        };
      }
      const result = await handleOAuthCallback({
        url: input.url || (req.method === 'GET' ? req.url : undefined),
        code: input.code,
        state: input.state,
      });
      if (req.method === 'GET') {
        sendText(req, res, 200, '<!doctype html><title>ZCode login complete</title><p>You can close this window.</p>', 'text/html; charset=utf-8');
      } else {
        sendJson(req, res, 200, { ok: true, ...result });
      }
    } catch (err) {
      const status = err.httpStatus || 500;
      if (req.method === 'GET') {
        sendText(req, res, status, '<!doctype html><title>ZCode login failed</title><p>' + String(err.message || err) + '</p>', 'text/html; charset=utf-8');
      } else {
        sendJson(req, res, status, { ok: false, error: claim.toErrorInfo(err, 'oauth-callback') });
      }
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log('ZCode claim server listening on http://127.0.0.1:' + DEFAULT_PORT);
    console.log('state file: ' + getStatePath());
    if (process.env.ZCODE_OAUTH_CALLBACK === '1') {
      startOAuthCallbackListener().then(() => {
        console.log('OAuth callback listener on http://127.0.0.1:' + DEFAULT_CALLBACK_PORT);
      }).catch((err) => {
        console.error('OAuth callback listener failed: ' + err.message);
      });
    }
  });
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_CALLBACK_PORT,
  getStatePath,
  defaultState,
  loadState,
  saveState,
  publicState,
  corsHeaders,
  readJsonBody,
  startOAuth,
  handleOAuthCallback,
  runClaimAll,
  setCaptchaProvider,
  createServer,
  startServer,
  startOAuthCallbackListener,
  routeRequest,
};
