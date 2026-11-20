# Android / backend integration

This document describes exactly how the Android app and any backend glue should use the
`claim/` bridge. All calls are loopback HTTP to `127.0.0.1:45210`; no external SDK is required
on the Java/Kotlin side.

## 1. Start the bridge

Ship/point the bundled Node runtime at `claim/claim-server.js` and start it with the app's data
directory so state survives restarts:

```sh
ZCODE_DATA_BASE_DIR=/data/data/<pkg>/files/zcode \
  node <app>/claim/claim-server.js
```

`claim-server.js` binds `127.0.0.1:45210` by default (`ZCODE_CLAIM_PORT` overrides it). It is
loopback-only; do not expose it on `0.0.0.0`. CORS accepts only `http://127.0.0.1:*`, which
covers a WebView served from a local socket. The OAuth callback listener on `45211` is optional
and enabled with `ZCODE_OAUTH_CALLBACK=1`.

Generated state file: `<ZCODE_DATA_BASE_DIR>/claim-state.json` (or
`$HOME/.zcode/v2/claim-state.json`). It holds `jwt`, `deviceMid`, `seq`, locale, platform and
pending OAuth state. It is written with mode `0600`. **Never log or return the JWT from
`/claim/status`.**

## 2. Where the JWT comes from (OAuth in a WebView)

1. App calls `POST /claim/start` with `{}` (optionally `{"locale":"zh-CN","platform":"linux-arm64"}`).
2. Response contains:

```json
{
  "ok": true,
  "mode": "oauth-start",
  "state": "…uuid4…",
  "redirectUri": "https://zcode.z.ai/app/oauth/login?redirect=zcode%3A%2F%2Foauth%2Fcallback&app_version=3.18.2",
  "authorizeUrl": "https://chat.z.ai/api/oauth/authorize?redirect_uri=…&response_type=code&client_id=client_P8X5CMWmlaRO9gyO-KSqtg&state=…",
  "callbackPort": 45211
}
```

3. Open `authorizeUrl` in the app WebView. The user logs in to `chat.z.ai`.
4. Intercept the `zcode://oauth/callback?code=…&state=…` navigation in the WebView client
   (`shouldOverrideUrlLoading`). Do **not** let the WebView load the `zcode://` scheme.
5. Forward it to the bridge:

```sh
curl -s -X POST http://127.0.0.1:45210/claim/oauth-callback \
  -H 'Content-Type: application/json' \
  -d '{"url":"zcode://oauth/callback?code=CODE&state=STATE"}'
```

   The bridge parses the URL, verifies `state` against the pending state, exchanges the code via
   `POST /api/v1/oauth/token`, and stores the JWT. It returns `{"ok":true,"configured":true}`.
   If `ZCODE_OAUTH_CALLBACK=1` is set, the WebView can alternatively navigate to
   `http://127.0.0.1:45211/?code=…&state=…`; that listener performs the same exchange and shows a
   "close this window" page.

Kotlin sketch for the intercept:

```kotlin
override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    val url = request.url.toString()
    if (url.startsWith("zcode://oauth/callback")) {
        // POST {"url": url} to http://127.0.0.1:45210/claim/oauth-callback
        // on a background thread, then close the WebView.
        return true
    }
    return false
}
```

If the app already owns a JWT (e.g. from native login), skip steps 1–5 and store it directly:

```sh
curl -s -X POST http://127.0.0.1:45210/claim/start \
  -H 'Content-Type: application/json' \
  -d '{"jwt":"<zcodejwttoken>","deviceMid":"<stable-uuid>"}'
```

## 3. Discover campaigns

`GET /claim/campaigns` calls `touch?seq=<n>` with the stored JWT and device UUID, increments the
persisted `seq`, and returns both raw deliveries and the extracted claim actions:

```json
{
  "ok": true,
  "seqUsed": 1,
  "serverTime": 0,
  "claimActions": [
    { "campaignId": "cmp-1", "resourcePosition": "banner", "planId": "plan-A", "priority": 10 }
  ]
}
```

This is useful to render the banner/popup and to decide whether a claim is available. It is safe
to call repeatedly — the `seq` is monotonic.

## 4. `MainActivity` bridge `claimPlan` → `/claim/*`

The JS-facing `claimPlan` method should **not** call `zcode.z.ai` directly from the app. Route it
through the bridge so headers, seq and the device UUID stay consistent:

1. `claimPlan({...})` (or the generic "claim all" button) issues
   `POST http://127.0.0.1:45210/claim/claim-all` with an empty JSON body `{}`.
2. The bridge runs: touch → captcha preflight → claim for each `claim_zcode_plan` action →
   `confirm` report → best-effort verify. It returns the structured result documented in
   `claim/README.md`.
3. To claim a single known plan, call the module API directly from Node
   (`claim.claimPlan({jwt, planId, deviceMid, platform, locale})`) rather than the bridge; the
   bridge's job is the full orchestrated flow.
4. To report an action manually, `POST /claim/report` with
   `{"campaignId":"cmp-1","actionType":"confirm"}` (or `"cancel"`).

Mapping summary:

| App action | HTTP call |
| --- | --- |
| "Login" | `POST /claim/start {}` → open `authorizeUrl` → `POST /claim/oauth-callback {"url":…}` |
| "Check status" | `GET /claim/status` |
| "Show offers" | `GET /claim/campaigns` |
| "Claim now" (bridge `claimPlan`) | `POST /claim/claim-all {}` |
| "Confirm/Cancel a delivery" | `POST /claim/report {"campaignId","actionType"}` |

## 5. CAPTCHA path (interactive)

After `/claim/claim-all`, check `captcha.required` in the response:

* `false`: normal flow; inspect `actions[].status`, `claimedCount`, `failedCount`, `errors`.
* `true`: ZCode requires an Aliyun CAPTCHA. The bridge skipped all claims. Present the Aliyun
  CAPTCHA widget in a WebView using `captcha.config.sceneId` / `region` / `prefix`, obtain the
  verify parameter from the solve callback, then retry:

```sh
curl -s -X POST http://127.0.0.1:45210/claim/claim-all \
  -H 'Content-Type: application/json' \
  -d '{"captchaVerifyParam":"<verifyParam from Aliyun SDK>","captchaRegion":"<region>"}'
```

The supplied param is used as a one-shot `captchaProvider` for that call. For an embedded Node
integration, register a persistent provider instead:

```js
const server = require('./claim/claim-server.js');
server.setCaptchaProvider(async ({ sceneId, region, prefix }) => {
  const param = await solveAliyunCaptchaInWebView({ sceneId, region, prefix });
  return { verifyParam: param, region };
});
```

The widget solve cannot be faked offline; do not attempt to synthesize a verify parameter.

## 6. Headers, state and anti-abuse — who owns what

The **bridge** owns all of these; the Android app must not regenerate them:

* `Authorization: Bearer <jwt>` — from the OAuth token exchange, persisted in state.
* `X-Device-Mid` — a stable UUID generated once and persisted. Keep it across restarts and
  reinstalls where possible; regenerating it looks like a new device.
* `seq` — persisted monotonic counter, incremented on each `touch` call.
* `X-ZCode-App-Version: 3.18.2`, `X-Platform` (linux-arm64 / win32-x64 / darwin-arm64),
  `X-Client-Language` (zh-CN / en-US).
* `X-Aliyun-Captcha-Verify-Param` / `X-Aliyun-Captcha-Verify-Region` — added only when the
  captcha config is enabled and a solved param is available.

Do not retry claim codes `1001`–`1005` (terminal). The result marks them
`claim_failed_terminal`.

## 7. Error handling

Bridge errors return HTTP 4xx/5xx with `{"ok":false,"error":{"stage","name","message","code","httpStatus"}}`.
Business-level claim failures still return HTTP 200 with `ok:false` and per-action detail; treat
the HTTP status and the `ok` flag as separate signals. Network timeouts are 15 s.

## 8. Testing without touching zcode.z.ai

```sh
node claim/test-claim.js   # 16 mocked tests, no network
```

Never point the test suite at the live service; use real credentials only from the app's normal
OAuth flow.
