'use strict';

const { randomUUID } = require('node:crypto');

const APP_VERSION = '3.18.2';
const DEFAULT_PLATFORM = 'linux-arm64';
const BASE_URL = 'https://zcode.z.ai';
const AUTHORIZE_ENDPOINT = 'https://chat.z.ai/api/oauth/authorize';
const CLIENT_ID = 'client_P8X5CMWmlaRO9gyO-KSqtg';
const DEFAULT_REDIRECT_URI =
  'https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback&app_version=3.18.2';
const TOKEN_PATH = '/api/v1/oauth/token';

function createOAuthState() {
  return randomUUID();
}

function buildAuthorizeUrl({ state, redirectUri, clientId } = {}) {
  const resolvedState = state || createOAuthState();
  const resolvedRedirectUri = redirectUri || DEFAULT_REDIRECT_URI;
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set('redirect_uri', resolvedRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId || CLIENT_ID);
  url.searchParams.set('state', resolvedState);
  return url.toString();
}

function parseCallbackUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new TypeError('callback url must be a non-empty string');
  }
  const raw = input.trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (err) {
    if (raw.includes('=')) {
      parsed = new URL('https://callback.local/?' + raw.replace(/^#/, ''));
    } else {
      throw new TypeError('invalid callback url: ' + raw);
    }
  }

  const params = new URLSearchParams(parsed.search);
  const fragment = parsed.hash.replace(/^#/, '');
  if (fragment) {
    for (const [key, value] of new URLSearchParams(fragment)) {
      if (!params.has(key)) params.set(key, value);
    }
  }

  const nested = params.get('redirect');
  if (nested && /^[a-z][a-z0-9+.-]*:\/\//i.test(nested)) {
    try {
      const nestedUrl = new URL(nested);
      for (const [key, value] of nestedUrl.searchParams) {
        if (!params.has(key)) params.set(key, value);
      }
    } catch (err) {
    }
  }

  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
    raw,
    host: parsed.host,
  };
}

function verifyCallbackState(callback, expectedState) {
  if (!callback || !expectedState) return false;
  return callback.state === expectedState;
}

function assertCallbackState(callback, expectedState) {
  if (!verifyCallbackState(callback, expectedState)) {
    const err = new Error('OAuth state mismatch (possible CSRF or stale callback)');
    err.name = 'OAuthStateError';
    err.code = 'STATE_MISMATCH';
    throw err;
  }
  return true;
}

function normalizeCode(value) {
  if (value === undefined || value === null) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

async function defaultHttpRequest({ method = 'GET', path, body, headers = {}, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = { code: -1, message: 'non-JSON response: ' + text.slice(0, 200) };
    }
    if (json && typeof json === 'object' && 'code' in json) json.code = normalizeCode(json.code);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeCodeForToken({
  code,
  state,
  redirectUri,
  platform = DEFAULT_PLATFORM,
  locale = 'zh-CN',
  httpRequest,
  fetchImpl,
  timeoutMs = 15000,
} = {}) {
  if (!code) {
    const err = new Error('authorization code is required');
    err.name = 'ValidationError';
    throw err;
  }
  const request = typeof httpRequest === 'function'
    ? httpRequest
    : (opts) => defaultHttpRequest({ ...opts, timeoutMs });
  const json = await request({
    method: 'POST',
    path: TOKEN_PATH,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-ZCode-App-Version': APP_VERSION,
      'X-Platform': platform,
      'X-Client-Language': locale,
    },
    body: {
      provider: 'zai',
      code,
      redirect_uri: redirectUri || DEFAULT_REDIRECT_URI,
      state,
    },
  });

  const responseCode = normalizeCode(json && json.code);
  const data = (json && json.data) || {};
  return {
    success: responseCode === 0 && typeof data.token === 'string' && data.token.length > 0,
    code: responseCode,
    token: data.token || null,
    expiresIn: data.expires_in ?? null,
    message: data.message || (json && json.message) || null,
    raw: json,
  };
}

module.exports = {
  APP_VERSION,
  BASE_URL,
  AUTHORIZE_ENDPOINT,
  CLIENT_ID,
  DEFAULT_PLATFORM,
  DEFAULT_REDIRECT_URI,
  TOKEN_PATH,
  buildAuthorizeUrl,
  createOAuthState,
  parseCallbackUrl,
  verifyCallbackState,
  assertCallbackState,
  exchangeCodeForToken,
};
