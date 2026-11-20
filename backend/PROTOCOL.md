# ZCode Android backend protocol

The Node bootstrap (`bootstrap.js`) replaces Electron's main process. It forks the
three plain-Node bundles and exposes a small HTTP/WebSocket bridge to the WebView.

## Transport

- `GET /health` — liveness + process state JSON.
- `GET /zcode-service-port` (WebSocket) — the renderer service port. Frames are
  **binary**: raw VSBuffer/ChannelServer protocol frames (`Uint8Array`). Bytes
  received from the WebView are forwarded verbatim to the host's `InitLocal`
  service port and vice versa. This is the faithful path; use the preload/RPC
  client from `out/preload` in the WebView.
- `POST /rpc` — JSON-RPC convenience wrapper over the same binary protocol.

## Bootstrap <-> child IPC

Children are `child_process.fork`ed with `serialization: 'advanced'` and
`NODE_OPTIONS=--require shim-parentport.js`. The shim exposes
`process.parentPort` backed by the fork IPC channel using envelopes:

```js
{ __zcode: 1, t: 'parent',    data, ports:[{__zcodePort:'<id>'}] }
{ __zcode: 1, t: 'portmsg',   id, data, ports:[...] }
{ __zcode: 1, t: 'portclose', id }
```

`MessagePort`s cannot be transferred over `fork` IPC in current Node, so they
are emulated by `FakePort` (child) and `RelayPort` (bootstrap) identified by a
string id. Both sides provide `postMessage`, `on('message', e => e.data/e.ports)`,
`start`, `close`, `once('close')`, `addEventListener`/`removeEventListener`.

## InitLocal

Sent by the bootstrap to the host right after spawn, with the service port:

```js
{
  type: 'init-local',
  databaseStartupId: '<uuid>',
  hostId: '<uuid>',
  deliveryKind: 'desktop_window',
  deviceMid: 'android-...',
  workspacePath, workspaceIdentity, agentWarmupTargets, agentSpawnFallbackCwd,
  zcodeBuiltinProviderConfigFilePath: '<backend>/config/provider/zcode-builtin.json',
  locale: 'en-US',
  remoteAssets: {},
  runtimeProcessEnvPatch: {}
}
// transfer list: [{ __zcodePort: servicePort.id }]
```

Host -> main `credential-cipher-request` / `credential-key-share-request` are
answered with failure results (no OS keyring on Android). Set
`ZCODE_CREDENTIAL_SECRET` (or `ZCODE_CREDENTIAL_SECRET_FILE`) for local decrypt.

## /rpc JSON-RPC

Request body:

```json
{ "id": 1, "channel": "<channelName>", "method": "<method>", "params": {} }
```

or `{ "method": "zcode.<Channel>.<method>", "params": {} }` (best-effort mapping).

Verified working example: `{ "id":1, "channel":"setting", "method":"get", "params":{} }`.

Known channel names (from the host's `[rpc:register]` log): `file`,
`media-preview`, `cloud-content`, `git`, `managed-worktrees`, `git-checkpoint`,
`system`, `terminal`, `setting`, `onboarding-record`, `credential`, `broadcast`,
`zcode-task`, `zcode-agent`, `zcode-session`, `project`, `task-groups`,
`remote-projects`, `cua-permission`, `cua-pip-session`, `conversation-share`,
`bots`, `file-watcher`, `oauth`, `source-server-workspace`, `usage-stats`,
`coding-plan-subscription`, `client-config`, `client-scenes`, `off-peak-task`,
`highspeed-card`, `skills`, `skill-sync`, `mcp-sync`, `gen-ui`, `plugins`,
`plugin-management`, `subagents`, `voice-input`, `marketing-touch`.

Response: `{ "jsonrpc":"2.0", "id":1, "result": ... }` or an `error` object.

Binary encoding (ChannelServer wire format): little-endian 7-bit VQL integers;
tags `0=undefined,1=string,2=bytes,3=bytes(VSBuffer),4=array,5=json-object,6=int`.
A request frame is one serialized array `[100, id, channel, method, arg]`.
Responses are `[201,id] + data` (ok) or `[202..205,id] + error` (failure);
`[200]` is the ready handshake frame.

## Known limitations

- Single host / single renderer service port; no multi-window, no scoped ports.
- No OS keyring, utilityProcess, BrowserWindow, dialog, shell, auto-update or CUA.
- Extension host is started with a minimal `extension-host/init` and no window attach.
- `zcode.*` name-to-channel mapping is partial; prefer the WebSocket path for full API coverage.
