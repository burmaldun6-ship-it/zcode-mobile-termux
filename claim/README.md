# ZCode 3.18.2 giveaway claim (mobile port)

Offline-testable implementation of the ZCode Desktop 3.18.2 giveaway/"zcode plan" claim flow.
All HTTP traffic targets `https://zcode.z.ai`. No credentials are bundled and the self-test
uses a mocked `fetch` — nothing here contacts the real service during verification.

## Files

| File | Purpose |
| --- | --- |
| `claim.js` | CommonJS module + standalone CLI; all endpoint calls, header construction, claim orchestration. |
| `oauth-helper.js` | OAuth authorize URL builder, callback parser (`zcode://` and web redirect), state verification, token exchange. |
| `claim-server.js` | Loopback HTTP bridge (`127.0.0.1`) for the Android app; persists JWT/deviceMid/seq. |
| `test-claim.js` | Dependency-injected mock-fetch self-test (`node claim/test-claim.js`). |
| `integration.md` | Exact Android/backend wiring instructions. |

## Shared request contract

Every request uses these headers (`X-Device-Mid` and `Authorization` omitted where no
device/JWT context exists, e.g. the OAuth token exchange):

```
Authorization: Bearer <zcodejwttoken>
X-ZCode-App-Version: 3.18.2
X-Platform: linux-arm64        # or win32-x64 / darwin-arm64
X-Device-Mid: <stable uuid>
X-Client-Language: zh-CN       # or en-US
Accept: application/json
Content-Type: application/json # POST only
```

The HTTP helper applies a 15 s `AbortController` timeout, normalizes `code` values that come
back as numeric strings (`"0"` → `0`), parses non-JSON bodies into a `ParseError`, and throws
`ZCodeError` with `code`, `httpStatus`, `response`, and `cause` fields on failure.

### Endpoints

| Operation | Call |
| --- | --- |
| Query campaigns | `GET /api/v1/marketing/touch?seq=<n>` → `{code:0,data:{server_time,language,deliveries:[...]}}` |
| Report action | `POST /api/v1/marketing/touch/action` body `{campaign_id,action_type:"confirm"\|"cancel"}` → `{code:0}` |
| Claim | `POST /api/v1/zcode-plan/billing/claim` body `{plan_id}` → `{code:0,data:{plan,server_time,message}}` |
| Preview | `GET /api/v1/zcode-plan/billing/preview?app_version=3.18.2&platform=linux-arm64` → `{code:0,data:{plans:[{planId,...}]}}` |
| Captcha config | `GET /api/v1/client/configs?app_version=3.18.2&platform=linux-arm64` → `{data:{configs:{captcha:{enabled,region,prefix,sceneId}}}}` |
| OAuth token | `POST /api/v1/oauth/token` body `{provider:"zai",code,redirect_uri,state}` → `{code:0,data:{token:"<JWT>"}}` |

Delivery filtering: `extractClaimActions()` keeps only the **first valid** delivery per
`resource_position` (`banner` / `popup`), then collects buttons whose
`action.type === 'claim_zcode_plan'` and `action.args.plan_id` is present.

Claim success is strictly `code === 0 && data.plan` exists. Codes `1001`–`1005` are treated as
terminal failures (do not retry blindly).

### CAPTCHA — important

`/api/v1/client/configs` controls the CAPTCHA requirement for the claim endpoint:

* If `enabled === false`, or any of `region` / `sceneId` is missing, **no captcha headers are sent**.
* If enabled, the claim request requires `X-Aliyun-Captcha-Verify-Param` and
  `X-Aliyun-Captcha-Verify-Region`. This is an **interactive Aliyun CAPTCHA solve** (slide/puzzle
  verification via the Aliyun SDK in the WebView); it cannot be computed offline.
* `claimAll()` performs a captcha preflight. When captcha is enabled and no `captchaProvider`
  callback is supplied, it **skips all claims**, sets `captcha.required = true`, marks actions
  `skipped_captcha_required`, and returns a reason string. No claim requests are sent.
* To support captcha, pass an async `captchaProvider({sceneId, region, prefix, platform, locale,
  campaignId, planId})` that performs the interactive solve and returns
  `{verifyParam, region}` (aliases `captchaVerifyParam` / `verify_param` / `captchaRegion` are
  accepted). With the HTTP server, either POST a pre-solved `captchaVerifyParam` (and optional
  `captchaRegion`) to `/claim/claim-all`, or register `setCaptchaProvider(fn)` from Node.

### Verification

There is no dedicated "verify claim" endpoint. `verifyClaim()` re-queries `touch` and `preview`
and reports `verified: remainingClaimActions.length === 0` plus the raw plan list. Treat it as a
best-effort post-condition check, not a server-side guarantee.

## Module API (CommonJS)

```js
const c = require('./claim/claim.js');

await c.loginWithAuthorizationCode({ code, state, redirectUri });
await c.getMarketingTouch({ jwt, deviceMid, seq, locale });
await c.getClaimPreviews({ jwt, platform });
await c.getCaptchaConfig({ jwt, platform });
await c.claimPlan({ jwt, planId, platform, captchaVerifyParam, captchaRegion, deviceMid, locale });
await c.reportTouchAction({ jwt, deviceMid, locale, campaignId, actionType: 'confirm' });
await c.verifyClaim({ jwt, deviceMid, platform });
await c.claimAll({ jwt, deviceMid, locale, platform, captchaProvider });
```

`claimAll()` result shape:

```json
{
  "ok": true,
  "platform": "linux-arm64",
  "locale": "zh-CN",
  "touch": { "serverTime": 0, "language": "zh-CN", "deliveryCount": 2 },
  "captcha": { "enabled": false, "required": false, "config": {}, "reason": null },
  "actions": [
    { "campaignId": "cmp-1", "resourcePosition": "banner", "planId": "plan-A",
      "priority": 10, "status": "claimed",
      "claim": { "success": true, "code": 0, "terminal": false, "message": "ok" },
      "report": { "success": true, "code": 0 } }
  ],
  "verification": { "verified": false, "remainingClaimActions": [], "plans": [] },
  "claimedCount": 1, "failedCount": 0, "errors": []
}
```

Action statuses: `pending`, `claimed`, `claimed_report_failed`, `claim_failed`,
`claim_failed_terminal`, `claim_error`, `captcha_failed`, `skipped_captcha_required`.

The low-level `requestJson()`, `buildHeaders()`, `normalizeCode()`, `toErrorInfo()` and
`extractClaimActions()` helpers are exported for tests and advanced integrations.

## CLI

Run from the repository root. Flags may be `--key value` or `--key=value`; environment
variables provide defaults (`ZCODE_JWT`, `ZCODE_DEVICE_MID`, `ZCODE_LOCALE`, `ZCODE_PLATFORM`,
`ZCODE_SEQ`, `ZCODE_CAPTCHA_VERIFY_PARAM`, `ZCODE_CAPTCHA_REGION`).

```sh
node claim/claim.js campaigns  --jwt "$JWT" --device-mid "$MID"
node claim/claim.js previews   --jwt "$JWT"
node claim/claim.js captcha-config --jwt "$JWT"
node claim/claim.js claim      --jwt "$JWT" --plan-id plan-A --device-mid "$MID"
node claim/claim.js report     --jwt "$JWT" --campaign-id cmp-1 --action-type confirm
node claim/claim.js verify     --jwt "$JWT" --device-mid "$MID"
node claim/claim.js claim-all  --jwt "$JWT" --device-mid "$MID"
node claim/claim.js login      --code "$CODE" --state "$STATE"
```

Output is pretty JSON on stdout; failures print a normalized error object on stderr and exit 1.

## OAuth flow

1. `state = uuid4()` (`oauth.createOAuthState()`).
2. `redirect_uri = https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback&app_version=3.18.2`
3. Open `https://chat.z.ai/api/oauth/authorize?redirect_uri=<urlencoded>&response_type=code&client_id=client_P8X5CMWmlaRO9gyO-KSqtg&state=<state>`.
4. After login, capture `zcode://oauth/callback?code=...&state=...` from the WebView.
5. Verify `state` matches (`oauth.assertCallbackState`), then exchange:
   `POST /api/v1/oauth/token` with `{provider:'zai',code,redirect_uri,state}` → JWT.

`oauth.parseCallbackUrl()` also accepts `https://zcode.z.ai/app/oauth/login?...&code=...&state=...`,
fragment-style callbacks, and nested `redirect=` URLs.

## Bridge server

```sh
node claim/claim-server.js                 # listens on 127.0.0.1:45210
ZCODE_OAUTH_CALLBACK=1 node claim/claim-server.js   # also listen on 127.0.0.1:45211
```

State (`jwt`, `deviceMid`, `seq`, locale, platform, pending OAuth state) is persisted to
`process.env.ZCODE_DATA_BASE_DIR` (a directory, or a `.json` file path) or
`$HOME/.zcode/v2/claim-state.json` with mode `0600`. The JWT is never returned by
`GET /claim/status`. CORS is allowed only for `http://127.0.0.1:*`.

### Endpoints

| Endpoint | Body / query | Result |
| --- | --- | --- |
| `POST /claim/start` | `{jwt?, code?, state?, url?, deviceMid?, locale?, platform?, redirectUri?}` | With `jwt`: stores it. With `code`/`state`/`url`: exchanges it. Otherwise: creates `state` + `authorizeUrl` to open in the WebView. |
| `GET /claim/status` | — | `{ok:true,state:{configured,deviceMid,seq,pendingState,authorizeUrl,...}}` (no JWT). |
| `GET /claim/campaigns` | — | Touch result plus `claimActions`; increments stored `seq`. |
| `POST /claim/claim-all` | `{captchaVerifyParam?,captchaRegion?,jwt?,deviceMid?,locale?,platform?}` | Full `claimAll()` result. A supplied verify param is used as a one-shot captcha provider. |
| `POST /claim/report` | `{campaignId,actionType}` | Confirm/cancel a delivery. |
| `POST /claim/oauth-callback` | `{url?,code?,state?}` | WebView forwards the `zcode://` redirect here; exchanges the code and stores the JWT. |

Optional callback listener (port 45211) accepts `GET /?code=...&state=...` or
`POST /` with `{url?,code?,state?}`, so a WebView redirect can be forwarded as a loopback HTTP
call. It responds with a small "you can close this window" HTML page for GET.

### curl examples

```sh
curl -s http://127.0.0.1:45210/claim/status

curl -s -X POST http://127.0.0.1:45210/claim/start \
  -H 'Content-Type: application/json' \
  -d '{"jwt":"<zcodejwttoken>","deviceMid":"stable-uuid","locale":"zh-CN","platform":"linux-arm64"}'

curl -s http://127.0.0.1:45210/claim/campaigns

curl -s -X POST http://127.0.0.1:45210/claim/claim-all \
  -H 'Content-Type: application/json' -d '{}'

curl -s -X POST http://127.0.0.1:45210/claim/claim-all \
  -H 'Content-Type: application/json' \
  -d '{"captchaVerifyParam":"<solved-param>","captchaRegion":"cn-shanghai"}'

curl -s -X POST http://127.0.0.1:45210/claim/report \
  -H 'Content-Type: application/json' \
  -d '{"campaignId":"cmp-1","actionType":"confirm"}'

curl -s -X POST http://127.0.0.1:45210/claim/oauth-callback \
  -H 'Content-Type: application/json' \
  -d '{"url":"zcode://oauth/callback?code=CODE&state=STATE"}'
```

## Anti-abuse notes

Persist a **stable** device UUID (never regenerate per run), send a monotonically increasing
`seq`, keep `X-Client-Language` consistent with the app locale, and always send the exact app
version/platform. Do not retry terminal claim codes `1001`–`1005`.

## Verification

```sh
node claim/test-claim.js
node --check claim/claim.js
node --check claim/claim-server.js
node --check claim/oauth-helper.js
node --check claim/test-claim.js
```

The self-test injects a mock `fetch` and verifies URLs, headers, bodies, numeric-string codes,
terminal failures, timeout/HTTP error normalization, captcha preflight, and the OAuth helpers.
No real login or claim is performed.
