'use strict';

// Injected into forked host / scheduler / extension-host via
//   NODE_OPTIONS="--require <this file>"
// It exposes an Electron-utilityProcess-compatible `process.parentPort`
// on top of Node's fork IPC channel (process.send / process.on('message')).
//
// Wire envelopes (all plain objects sent with serialization:'advanced'):
//   { __zcode:1, t:'parent',    data, ports:[portRef,...] }
//   { __zcode:1, t:'portmsg',   id, data, ports:[portRef,...] }
//   { __zcode:1, t:'portclose', id }
//   portRef = { __zcodePort:'<id>' }
//
// MessagePorts are emulated by FakePort. On Electron the host receives
// MessagePortMain objects whose `on('message')` yields {data, ports}; we
// reproduce that exact shape.

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const TAG = 1;

function isEnvelope(m) {
  return !!m && typeof m === 'object' && m.__zcode === TAG;
}

function portRef(id) {
  return { __zcodePort: id };
}

function refId(r) {
  return r && typeof r === 'object' && typeof r.__zcodePort === 'string'
    ? r.__zcodePort
    : null;
}

class FakePort extends EventEmitter {
  constructor(shim, id) {
    super();
    this.id = id;
    this._shim = shim;
    this._closed = false;
  }

  postMessage(data, transferList) {
    if (this._closed) return;
    this._shim._sendPortMessage(this.id, data, transferList);
  }

  start() {
    // Messages are delivered eagerly; start() is a no-op for compatibility.
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._shim._sendPortClose(this.id);
    this.emit('close');
  }

  addEventListener(type, listener) {
    this.on(type, listener);
  }

  removeEventListener(type, listener) {
    this.off(type, listener);
  }

  _deliver(data, ports) {
    if (this._closed) return;
    this.emit('message', { data, ports });
  }

  _deliverClose() {
    if (this._closed) return;
    this._closed = true;
    this.emit('close');
  }
}

class ParentPort extends EventEmitter {
  constructor(shim) {
    super();
    this._shim = shim;
  }

  postMessage(data, transferList) {
    this._shim._sendParentMessage(data, transferList);
  }
}

class ParentPortShim {
  constructor() {
    this._ports = new Map();
    this.parentPort = new ParentPort(this);
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      enumerable: true,
      value: this.parentPort,
    });
    process.on('message', (m) => this._onMessage(m));
  }

  _port(id) {
    let p = this._ports.get(id);
    if (!p) {
      p = new FakePort(this, id);
      this._ports.set(id, p);
    }
    return p;
  }

  _refsFromTransfer(list) {
    const refs = [];
    if (!Array.isArray(list)) return refs;
    for (const item of list) {
      if (item instanceof FakePort) refs.push(portRef(item.id));
    }
    return refs;
  }

  _portsFromRefs(refs) {
    if (!Array.isArray(refs)) return [];
    const out = [];
    for (const r of refs) {
      const id = refId(r);
      if (id) out.push(this._port(id));
    }
    return out;
  }

  _send(envelope) {
    try {
      process.send(envelope);
    } catch (e) {
      // IPC may be gone during shutdown; nothing useful to do here.
    }
  }

  _sendParentMessage(data, transferList) {
    this._send({ __zcode: TAG, t: 'parent', data, ports: this._refsFromTransfer(transferList) });
  }

  _sendPortMessage(id, data, transferList) {
    this._send({ __zcode: TAG, t: 'portmsg', id, data, ports: this._refsFromTransfer(transferList) });
  }

  _sendPortClose(id) {
    this._send({ __zcode: TAG, t: 'portclose', id });
  }

  _onMessage(m) {
    if (!isEnvelope(m)) return;
    if (m.t === 'parent') {
      const ports = this._portsFromRefs(m.ports);
      this.parentPort.emit('message', { data: m.data, ports });
      return;
    }
    if (m.t === 'portmsg') {
      const p = this._port(m.id);
      p._deliver(m.data, this._portsFromRefs(m.ports));
      return;
    }
    if (m.t === 'portclose') {
      const p = this._port(m.id);
      p._deliverClose();
    }
  }
}

// Avoid installing twice if --require is somehow applied more than once.
if (!process.parentPort || !(process.parentPort instanceof ParentPort)) {
  new ParentPortShim();
}

module.exports = { FakePort, ParentPort, ParentPortShim, randomUUID };
