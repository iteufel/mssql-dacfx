import { DacFxError, type Transport } from './client.js';

type Runtime = {
  getAssemblyExports(name: string): Promise<{ JsExports?: { Invoke(request: string): string } }>;
};
const runtimes = new Map<string, Promise<Transport>>();

/** The .NET runtime lives for the lifetime of its JS realm. Reuse it across clients. */
export function loadWasm(dotnetUrl: string): Promise<Transport> {
  const existing = runtimes.get(dotnetUrl);
  if (existing) return existing;
  const loading = (async () => {
    const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ dotnetUrl) as {
      dotnet: { withDiagnosticTracing(value: boolean): { create(): Promise<Runtime> } };
    };
    const runtime = await module.dotnet.withDiagnosticTracing(false).create();
    const exports = await runtime.getAssemblyExports('MssqlDac.Wasm');
    if (!exports.JsExports) throw new DacFxError('DacFx WASM exports are missing.', 'WASM_EXPORTS_MISSING');
    const bridge = exports.JsExports;
    return async (request: string) => bridge.Invoke(request);
  })();
  runtimes.set(dotnetUrl, loading);
  void loading.catch(() => runtimes.delete(dotnetUrl));
  return loading;
}
