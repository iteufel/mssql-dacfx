import { createClient } from './client.js';
import { loadWasm } from './wasm.js';
import type { WasmDacFx, WasmOptions } from './types.js';
export { DacFxError } from './client.js';
export type * from './types.js';

/** Works in browsers and module workers; never imports Node built-ins. */
export async function createDacFx(options: WasmOptions = {}): Promise<WasmDacFx> {
  if (!options.assetsPath) throw new TypeError('Set assetsPath to the served directory containing _framework.');
  const base = new URL(`${options.assetsPath.replace(/\/$/, '')}/`, globalThis.location.href);
  return createClient(await loadWasm(new URL('_framework/dotnet.js', base).href));
}
