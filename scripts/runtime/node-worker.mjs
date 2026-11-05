import { Worker as NodeWorker, MessagePort } from 'node:worker_threads';

const workers = new Set();
let references = 0;

// The .NET browser runtime expects EventTarget-style worker messages. Its
// Emscripten layer also uses Node's EventEmitter interface, so retain both.
export class Worker extends NodeWorker {
  #listeners = new Map();

  constructor(url, options) {
    // These are internal runtime workers, not application entry points. Parent
    // V8/test-runner flags can be rejected when explicitly passed to Workers.
    super(new URL(url), { ...options, type: 'module', execArgv: [] });
    workers.add(this);
    this.once('exit', () => workers.delete(this));
    if (references === 0) this.unref();
  }

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) ?? new Map();
    if (listeners.has(listener)) return;
    const callback = data => {
      const event = type === 'message' ? { data } : data;
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
      // Mono transfers a dedicated MessagePort, then starts it in the listener.
      // Only the workers need to keep requests alive; ports must not keep an
      // otherwise idle consumer process running after release().
      unrefPorts(data);
    };
    listeners.set(listener, callback);
    this.#listeners.set(type, listeners);
    this.on(type, callback);
  }

  removeEventListener(type, listener) {
    const listeners = this.#listeners.get(type);
    const callback = listeners?.get(listener);
    if (callback) this.off(type, callback);
    listeners?.delete(listener);
  }
}

function unrefPorts(value, depth = 0) {
  if (value instanceof MessagePort) { value.unref(); return; }
  if (depth < 3 && value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) unrefPorts(item, depth + 1);
  }
}

// Keep pending work alive, but let a Node/Bun process exit when clients are idle.
export function retain() {
  if (references++ === 0) for (const worker of workers) worker.ref();
}

export function release() {
  if (references <= 0) throw new Error('Unbalanced WASM worker release.');
  if (--references === 0) for (const worker of workers) worker.unref();
}

export function terminate() {
  for (const worker of workers) void worker.terminate();
  workers.clear();
}
