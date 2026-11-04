import { DacFxError, type Transport } from './client.js';

type Runtime = {
  getAssemblyExports(name: string): Promise<{ JsExports?: { Invoke(request: string): Promise<string> } }>;
};
type WorkerLifetime = { retain(): void; release(): void; terminate(): void };
const runtimes = new Map<string, Promise<Transport>>();

/** The .NET runtime lives for the lifetime of its JS realm. Reuse it across clients. */
export function loadWasm(dotnetUrl: string): Promise<Transport> {
  const existing = runtimes.get(dotnetUrl);
  if (existing) return existing;
  const loading = (async () => {
    const node = typeof process === 'object' && Boolean(process.versions?.node);
    if (typeof SharedArrayBuffer === 'undefined' || (!node && (!globalThis.crossOriginIsolated || typeof Worker === 'undefined'))) {
      throw new DacFxError(
        'Threaded WASM requires SharedArrayBuffer. Serve the page and assets with Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp over HTTPS (or localhost).',
        'WASM_THREADS_UNAVAILABLE',
      );
    }
    const workers = node
      ? await import(/* webpackIgnore: true */ /* @vite-ignore */ new URL('mssql-node-worker.mjs', dotnetUrl).href) as WorkerLifetime
      : undefined;
    workers?.retain();
    try {
      const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ dotnetUrl) as {
        dotnet: { withDiagnosticTracing(value: boolean): { create(): Promise<Runtime> } };
      };
      const runtime = await module.dotnet.withDiagnosticTracing(false).create();
      const exports = await runtime.getAssemblyExports('MssqlDac.Wasm');
      if (!exports.JsExports) throw new DacFxError('DacFx WASM exports are missing.', 'WASM_EXPORTS_MISSING');
      const bridge = exports.JsExports;
      let pending: Promise<unknown> = Promise.resolve();
      return (request: string) => {
        const result = pending.then(async () => {
          workers?.retain();
          try { return await bridge.Invoke(request); }
          finally { workers?.release(); }
        });
        // A rejected operation must not poison the queue for subsequent requests.
        pending = result.catch(() => {});
        return result;
      };
    } catch (error) {
      workers?.terminate();
      throw error;
    } finally { workers?.release(); }
  })();
  runtimes.set(dotnetUrl, loading);
  void loading.catch(() => runtimes.delete(dotnetUrl));
  return loading;
}
