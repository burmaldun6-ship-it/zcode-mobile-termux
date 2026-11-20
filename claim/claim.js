'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exchangeCodeForToken, DEFAULT_REDIRECT_URI } = require('./oauth-helper');

const BASE_URL = 'https://zcode.z.ai';
const APP_VERSION = '3.18.2';
const DEFAULT_PLATFORM = 'linux-arm64';
const DEFAULT_LOCALE = 'zh-CN';
const DEFAULT_TIMEOUT_MS = 15000;
const TERMINAL_FAILURE_CODES = new Set([1001, 1002, 1003, 1004, 1005]);

const PATHS = {
  touch: '/api/v1/marketing/touch',
  touchAction: '/api/v1/marketing/touch/action',
  claim: '/api/v1/zcode-plan/billing/claim',
  preview: '/api/v1/zcode-plan/billing/preview',
  configs: '/api/v1/client/configs',
};

class ZCodeError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = info.name || 'ZCodeError';
    this.code = info.code ?? null;
    this.httpStatus = info.httpStatus ?? null;
    this.response = info.response ?? null;
    this.cause = info.cause ?? null;
    this.retryAfter = info.retryAfter ?? null;
  }
}

function normalizeCode(value) {
  if (value === undefined || value === null) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function toErrorInfo(err, stage = 'request') {
  if (!err) {
    return { stage, name: 'Error', message: 'unknown error', code: null, httpStatus: null };
  }
  return {
    stage,
    name: err.name || 'Error',
    message: err.message || String(err),
    code: err.code ?? null,
      httpStatus: err.httpStatus ?? null,
      retryAfter: err.retryAfter ?? null,
    };

}

function clip(value, max = 4000) {
  if (value === undefined || value === null) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : text.slice(0, max) + '…[truncated]';
}

function traceFile() {
  const configured = process.env.ZCODE_DATA_BASE_DIR;
  const statePath = configured && path.extname(configured).toLowerCase() === '.json'
    ? configured
    : path.join(configured || path.join(os.homedir(), '.zcode', 'v2'), 'claim-state.json');
  return path.join(path.dirname(statePath), '..', 'logs', 'claim-trace.log');
}

function trace(event, data) {
  if (process.env.ZCODE_CLAIM_TRACE === '0') return;
  try {
    const file = traceFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n');
  } catch (err) {}
}

function redactHeaders(headers) {
  const copy = { ...headers };
  if (copy.Authorization) copy.Authorization = 'Bearer <redacted>';
  for (const key of Object.keys(copy)) {
    if (/captcha/i.test(key) && typeof copy[key] === 'string' && copy[key].length > 16) {
      copy[key] = copy[key].slice(0, 16) + '…';
    }
  }
  return copy;
}

function buildHeaders({
  jwt,
  platform = DEFAULT_PLATFORM,
  deviceMid,
  locale = DEFAULT_LOCALE,
  hasBody = false,
  extra = {},
} = {}) {
  const headers = {
    'Accept': 'application/json',
    'X-ZCode-App-Version': APP_VERSION,
    'X-Platform': platform || DEFAULT_PLATFORM,
    'X-Client-Language': locale || DEFAULT_LOCALE,
  };
  if (jwt) headers['Authorization'] = 'Bearer ' + jwt;
  if (deviceMid) headers['X-Device-Mid'] = deviceMid;
  if (hasBody) headers['Content-Type'] = 'application/json';
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') headers[key] = value;
  }
  return headers;
}

function buildUrl(path, query = {}) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestJson({
  method = 'GET',
  path,
  query,
  body,
  jwt,
  platform = DEFAULT_PLATFORM,
  deviceMid,
  locale = DEFAULT_LOCALE,
  extraHeaders,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!path) throw new ZCodeError('path is required', { name: 'ValidationError' });
  const url = buildUrl(path, query);
  const headers = buildHeaders({
    jwt,
    platform,
    deviceMid,
    locale,
    hasBody: body !== undefined,
    extra: extraHeaders,
  });
  const startedAt = Date.now();
  trace('http_request', { method, url, headers: redactHeaders(headers), body: body ? clip(body) : null });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await (fetchImpl || fetch)(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (err) {
      trace('http_nonjson', { method, url, status: response.status, durationMs: Date.now() - startedAt, text: clip(text) });
      throw new ZCodeError('non-JSON response from ' + path, {
        name: 'ParseError',
        httpStatus: response.status,
        response: text.slice(0, 500),
        cause: err,
      });
    }
    trace('http_response', {
      method,
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
      response: clip(json),
    });
    if (!response.ok) {
      throw new ZCodeError('HTTP ' + response.status + ' from ' + path, {
        name: 'HttpError',
        httpStatus: response.status,
        code: normalizeCode(json && json.code),
        response: json,
        retryAfter: response.headers && typeof response.headers.get === 'function'
          ? response.headers.get('retry-after') || null
          : null,
      });
    }
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const normalized = { ...json };
      if ('code' in normalized) normalized.code = normalizeCode(normalized.code);
      return normalized;
    }
    return json;
  } catch (err) {
    trace('http_error', {
      method,
      url,
      durationMs: Date.now() - startedAt,
      error: toErrorInfo(err, path),
    });
    if (err instanceof ZCodeError) throw err;
    const aborted = controller.signal.aborted;
    throw new ZCodeError(
      aborted ? 'request timed out after ' + timeoutMs + 'ms: ' + path : 'request failed: ' + path,
      { name: aborted ? 'TimeoutError' : 'NetworkError', cause: err }
    );
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(json, operation) {
  if (!json || typeof json !== 'object') {
    throw new ZCodeError('empty response from ' + operation, { name: 'ProtocolError' });
  }
  const code = normalizeCode(json.code);
  if (code !== 0) {
    throw new ZCodeError(operation + ' failed with code ' + code, {
      name: 'ApiError',
      code,
      response: json,
    });
  }
  return json;
}

async function loginWithAuthorizationCode({
  code,
  state,
  redirectUri,
  platform = DEFAULT_PLATFORM,
  locale = DEFAULT_LOCALE,
  fetchImpl,
} = {}) {
  return exchangeCodeForToken({
    code,
    state,
    redirectUri: redirectUri || DEFAULT_REDIRECT_URI,
    platform,
    locale,
    httpRequest: (opts) => requestJson({ ...opts, fetchImpl }),
  });
}

async function getMarketingTouch({
  jwt,
  deviceMid,
  seq = 1,
  locale = DEFAULT_LOCALE,
  platform = DEFAULT_PLATFORM,
  fetchImpl,
} = {}) {
  const json = assertOk(
    await requestJson({
      method: 'GET',
      path: PATHS.touch,
      query: { seq },
      jwt,
      deviceMid,
      locale,
      platform,
      fetchImpl,
    }),
    'getMarketingTouch'
  );
  const data = json.data || {};
  return {
    success: true,
    code: json.code,
    serverTime: data.server_time ?? null,
    language: data.language ?? null,
    deliveries: Array.isArray(data.deliveries) ? data.deliveries : [],
    raw: json,
  };
}

function extractClaimActions(deliveries) {
  const actions = [];
  const seenPositions = new Set();
  if (!Array.isArray(deliveries)) return actions;

  for (const delivery of deliveries) {
    if (!delivery || typeof delivery !== 'object') continue;
    const position = delivery.resource_position;
    if (position !== 'banner' && position !== 'popup') continue;
    if (seenPositions.has(position)) continue;
    if (!delivery.campaign_id) continue;

    const payload = delivery[position] || delivery.banner || delivery.popup;
    const buttons = payload && Array.isArray(payload.buttons) ? payload.buttons : [];
    const found = [];
    for (const button of buttons) {
      if (!button || typeof button !== 'object') continue;
      const action = button.action && typeof button.action === 'object' ? button.action : button;
      if (action.type !== 'claim_zcode_plan') continue;
      const args = action.args && typeof action.args === 'object' ? action.args : {};
      const planId = args.plan_id ?? args.planId;
      if (planId === undefined || planId === null || planId === '') continue;
      found.push({
        campaignId: delivery.campaign_id,
        resourcePosition: position,
        planId,
        priority: delivery.priority ?? null,
        buttonLabel: button.label ?? button.text ?? null,
      });
    }
    if (found.length) {
      seenPositions.add(position);
      actions.push(...found);
    }
  }
  return actions;
}

async function getClaimPreviews({ jwt, platform = DEFAULT_PLATFORM, fetchImpl } = {}) {
  const json = assertOk(
    await requestJson({
      method: 'GET',
      path: PATHS.preview,
      query: { app_version: APP_VERSION, platform },
      jwt,
      platform,
      fetchImpl,
    }),
    'getClaimPreviews'
  );
  const data = json.data || {};
  return {
    success: true,
    code: json.code,
    plans: Array.isArray(data.plans) ? data.plans : [],
    serverTime: data.server_time ?? null,
    raw: json,
  };
}

async function getCaptchaConfig({ jwt, platform = DEFAULT_PLATFORM, fetchImpl } = {}) {
  const json = await requestJson({
    method: 'GET',
    path: PATHS.configs,
    query: { app_version: APP_VERSION, platform },
    jwt,
    platform,
    fetchImpl,
  });
  assertOk(json, 'getCaptchaConfig');
  const configs = (json.data && json.data.configs) || {};
  const rawConfig = configs.captcha || {};
  const config = {
    enabled: rawConfig.enabled === true,
    region: rawConfig.region ?? null,
    prefix: rawConfig.prefix ?? null,
    sceneId: rawConfig.sceneId ?? rawConfig.scene_id ?? null,
  };
  const enabled = config.enabled && !!config.region && !!config.sceneId;
  return {
    success: true,
    code: json.code,
    enabled,
    config,
    raw: json,
  };
}

async function claimPlan({
  jwt,
  planId,
  platform = DEFAULT_PLATFORM,
  captchaVerifyParam,
  captchaRegion,
  deviceMid,
  locale = DEFAULT_LOCALE,
  fetchImpl,
} = {}) {
  if (planId === undefined || planId === null || planId === '') {
    throw new ZCodeError('planId is required', { name: 'ValidationError' });
  }
  const extra = {};
  if (captchaVerifyParam) extra['X-Aliyun-Captcha-Verify-Param'] = captchaVerifyParam;
  if (captchaRegion) extra['X-Aliyun-Captcha-Verify-Region'] = captchaRegion;

  const json = await requestJson({
    method: 'POST',
    path: PATHS.claim,
    body: { plan_id: planId },
    jwt,
    platform,
    deviceMid,
    locale,
    extraHeaders: extra,
    fetchImpl,
  });
  const code = normalizeCode(json && json.code);
  const data = (json && json.data) || {};
  return {
    success: code === 0 && !!data.plan,
    code,
    terminal: TERMINAL_FAILURE_CODES.has(code),
    message: data.message ?? (json && json.message) ?? null,
    plan: data.plan ?? null,
    serverTime: data.server_time ?? null,
    raw: json,
  };
}

async function reportTouchAction({
  jwt,
  deviceMid,
  locale = DEFAULT_LOCALE,
  platform = DEFAULT_PLATFORM,
  campaignId,
  actionType = 'confirm',
  fetchImpl,
} = {}) {
  if (!campaignId) throw new ZCodeError('campaignId is required', { name: 'ValidationError' });
  if (actionType !== 'confirm' && actionType !== 'cancel') {
    throw new ZCodeError('actionType must be confirm or cancel', { name: 'ValidationError' });
  }
  const json = await requestJson({
    method: 'POST',
    path: PATHS.touchAction,
    body: { campaign_id: campaignId, action_type: actionType },
    jwt,
    platform,
    deviceMid,
    locale,
    fetchImpl,
  });
  const code = normalizeCode(json && json.code);
  return { success: code === 0, code, raw: json };
}

async function verifyClaim({
  jwt,
  deviceMid,
  platform = DEFAULT_PLATFORM,
  locale = DEFAULT_LOCALE,
  seq = 1,
  fetchImpl,
} = {}) {
  const touch = await getMarketingTouch({ jwt, deviceMid, seq, locale, platform, fetchImpl });
  const preview = await getClaimPreviews({ jwt, platform, fetchImpl });
  const remaining = extractClaimActions(touch.deliveries);
  return {
    verified: remaining.length === 0,
    remainingClaimActions: remaining,
    plans: preview.plans,
    touchServerTime: touch.serverTime,
    previewServerTime: preview.serverTime,
    raw: { touch: touch.raw, preview: preview.raw },
  };
}

function captchaResultFromProvider(value, config) {
  const verifyParam = value && (value.verifyParam ?? value.captchaVerifyParam ?? value.verify_param ?? value.param);
  const region =
    value && (value.region ?? value.captchaRegion ?? value.captcha_region ?? value.verifyRegion) ||
    config.region;
  return { verifyParam, region };
}

async function claimAll({
  jwt,
  deviceMid,
  locale = DEFAULT_LOCALE,
  platform = DEFAULT_PLATFORM,
  captchaProvider,
  seq = 1,
  fetchImpl,
} = {}) {
  const result = {
    ok: false,
    platform,
    locale,
    touch: null,
    captcha: {
      enabled: false,
      required: false,
      config: null,
      reason: null,
    },
    actions: [],
    verification: null,
    claimedCount: 0,
    failedCount: 0,
    errors: [],
  };
  trace('claim_all_start', { seq, platform, locale, deviceMid });

  let touch;
  try {
    touch = await getMarketingTouch({ jwt, deviceMid, seq, locale, platform, fetchImpl });
    result.touch = {
      serverTime: touch.serverTime,
      language: touch.language,
      deliveryCount: touch.deliveries.length,
    };
    trace('claim_all_touch', {
      seq,
      deliveryCount: touch.deliveries.length,
      deliveries: clip(touch.deliveries),
    });
  } catch (err) {
    result.errors.push(toErrorInfo(err, 'marketing-touch'));
    return result;
  }

  const actions = extractClaimActions(touch.deliveries);
  result.actions = actions.map((action) => ({ ...action, status: 'pending' }));
  trace('claim_all_actions', { count: actions.length, actions });
  if (!actions.length) {
    result.ok = true;
    result.verification = {
      verified: true,
      remainingClaimActions: [],
      plans: [],
      skipped: true,
      reason: 'no claim actions in marketing touch; skipped verification to avoid rate limits',
    };
    return result;
  }

  let captchaConfig;
  try {
    captchaConfig = await getCaptchaConfig({ jwt, platform, fetchImpl });
    result.captcha.enabled = captchaConfig.enabled;
    result.captcha.config = captchaConfig.config;
    trace('claim_all_captcha', { enabled: captchaConfig.enabled, config: captchaConfig.config });
  } catch (err) {
    result.errors.push(toErrorInfo(err, 'captcha-config'));
  }

  if (captchaConfig && captchaConfig.enabled) {
    if (typeof captchaProvider !== 'function') {
      result.captcha.required = true;
      result.captcha.reason =
        'Aliyun CAPTCHA is enabled. Supply an async captchaProvider that performs the interactive solve; ' +
        'otherwise the claim cannot be sent.';
      for (const action of result.actions) action.status = 'skipped_captcha_required';
      result.failedCount = result.actions.length;
      return result;
    }
  }

  for (const action of result.actions) {
    let verifyParam;
    let region;
    if (captchaConfig && captchaConfig.enabled) {
      try {
        const solved = await captchaProvider({
          sceneId: captchaConfig.config.sceneId,
          region: captchaConfig.config.region,
          prefix: captchaConfig.config.prefix,
          platform,
          locale,
          campaignId: action.campaignId,
          planId: action.planId,
        });
        const resolved = captchaResultFromProvider(solved, captchaConfig.config);
        if (!resolved.verifyParam) {
          throw new ZCodeError('captchaProvider did not return a verify param', { name: 'CaptchaError' });
        }
        verifyParam = resolved.verifyParam;
        region = resolved.region;
        action.captcha = { provided: true, region: region ?? null };
      } catch (err) {
        action.status = 'captcha_failed';
        action.error = toErrorInfo(err, 'captcha');
        result.errors.push(action.error);
        continue;
      }
    }

    try {
      const claim = await claimPlan({
        jwt,
        planId: action.planId,
        platform,
        captchaVerifyParam: verifyParam,
        captchaRegion: region,
        deviceMid,
        locale,
        fetchImpl,
      });
      action.claim = {
        success: claim.success,
        code: claim.code,
        terminal: claim.terminal,
        message: claim.message,
      };
      trace('claim_result', {
        planId: action.planId,
        campaignId: action.campaignId,
        code: claim.code,
        success: claim.success,
        message: claim.message,
      });
      if (!claim.success) {
        action.status = claim.terminal ? 'claim_failed_terminal' : 'claim_failed';
        continue;
      }
      action.status = 'claimed';
      try {
        const report = await reportTouchAction({
          jwt,
          deviceMid,
          locale,
          platform,
          campaignId: action.campaignId,
          actionType: 'confirm',
          fetchImpl,
        });
        action.report = { success: report.success, code: report.code };
        if (!report.success) action.status = 'claimed_report_failed';
      } catch (err) {
        action.status = 'claimed_report_failed';
        action.error = toErrorInfo(err, 'report');
        result.errors.push(action.error);
      }
    } catch (err) {
      action.status = 'claim_error';
      action.error = toErrorInfo(err, 'claim');
      result.errors.push(action.error);
    }
  }

  try {
    result.verification = await verifyClaim({ jwt, deviceMid, platform, locale, seq, fetchImpl });
  } catch (err) {
    result.errors.push(toErrorInfo(err, 'verify'));
  }

  result.claimedCount = result.actions.filter((action) => action.claim && action.claim.success).length;
  result.failedCount = result.actions.length - result.claimedCount;
  result.ok = result.claimedCount === result.actions.length && result.errors.length === 0;
  trace('claim_all_finish', {
    ok: result.ok,
    claimedCount: result.claimedCount,
    failedCount: result.failedCount,
    errors: result.errors,
  });
  return result;
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        parsed[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          parsed[key] = next;
          i++;
        } else {
          parsed[key] = true;
        }
      }
    } else {
      parsed._.push(token);
    }
  }
  return parsed;
}

function envOrArg(args, key, envKey, fallback) {
  if (args[key] !== undefined && args[key] !== true) return args[key];
  if (process.env[envKey]) return process.env[envKey];
  return fallback;
}

async function runCli(argv) {
  const args = parseArgs(argv);
  const command = args._[0] || 'status';
  const jwt = envOrArg(args, 'jwt', 'ZCODE_JWT', undefined);
  const deviceMid = envOrArg(args, 'device-mid', 'ZCODE_DEVICE_MID', undefined);
  const locale = envOrArg(args, 'locale', 'ZCODE_LOCALE', DEFAULT_LOCALE);
  const platform = envOrArg(args, 'platform', 'ZCODE_PLATFORM', DEFAULT_PLATFORM);
  const seq = Number(envOrArg(args, 'seq', 'ZCODE_SEQ', 1)) || 1;
  const base = { jwt, deviceMid, locale, platform };

  switch (command) {
    case 'login':
      return loginWithAuthorizationCode({
        code: args.code,
        state: args.state,
        redirectUri: args['redirect-uri'],
        platform,
        locale,
      });
    case 'touch':
      return getMarketingTouch({ ...base, seq });
    case 'campaigns': {
      const touch = await getMarketingTouch({ ...base, seq });
      return { serverTime: touch.serverTime, language: touch.language, deliveries: touch.deliveries, claimActions: extractClaimActions(touch.deliveries) };
    }
    case 'previews':
      return getClaimPreviews({ jwt, platform });
    case 'captcha-config':
      return getCaptchaConfig({ jwt, platform });
    case 'claim': {
      const captchaVerifyParam = envOrArg(args, 'captcha-verify-param', 'ZCODE_CAPTCHA_VERIFY_PARAM', undefined);
      const captchaRegion = envOrArg(args, 'captcha-region', 'ZCODE_CAPTCHA_REGION', undefined);
      return claimPlan({ ...base, planId: args['plan-id'], captchaVerifyParam, captchaRegion });
    }
    case 'report':
      return reportTouchAction({
        ...base,
        campaignId: args['campaign-id'],
        actionType: args['action-type'] || 'confirm',
      });
    case 'verify':
      return verifyClaim({ ...base, seq });
    case 'claim-all': {
      const verifyParam = envOrArg(args, 'captcha-verify-param', 'ZCODE_CAPTCHA_VERIFY_PARAM', undefined);
      const region = envOrArg(args, 'captcha-region', 'ZCODE_CAPTCHA_REGION', undefined);
      const captchaProvider = verifyParam
        ? async () => ({ verifyParam, region })
        : undefined;
      return claimAll({ ...base, seq, captchaProvider });
    }
    default:
      throw new ZCodeError('unknown command: ' + command, { name: 'UsageError' });
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(JSON.stringify(toErrorInfo(err, 'cli'), null, 2));
      process.exitCode = 1;
    });
}

module.exports = {
  BASE_URL,
  APP_VERSION,
  DEFAULT_PLATFORM,
  DEFAULT_LOCALE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_REDIRECT_URI,
  PATHS,
  TERMINAL_FAILURE_CODES,
  ZCodeError,
  normalizeCode,
  toErrorInfo,
  buildHeaders,
  buildUrl,
  requestJson,
  assertOk,
  extractClaimActions,
  loginWithAuthorizationCode,
  getMarketingTouch,
  getClaimPreviews,
  getCaptchaConfig,
  claimPlan,
  reportTouchAction,
  verifyClaim,
  claimAll,
  parseArgs,
  runCli,
};
