import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient, createWasmClient, DacFxError, type Transport } from './client.js';
import { loadWasm } from './wasm.js';
import type { CliOptions, DacFx, InitOptions, WasmDacFx, WasmOptions } from './types.js';
export { DacFxError } from './client.js';
export type * from './types.js';

export function createDacFx(options: WasmOptions & { runtime: 'wasm' }): Promise<WasmDacFx>;
export function createDacFx(options?: CliOptions): Promise<DacFx>;
export function createDacFx(options: InitOptions): Promise<DacFx | WasmDacFx>;
export async function createDacFx(options: InitOptions = {}): Promise<DacFx | WasmDacFx> {
  const runtime = options.runtime ?? 'cli';
  if (runtime !== 'cli' && runtime !== 'wasm') throw new TypeError(`Unknown runtime: ${runtime}`);
  const assets = options.assetsPath
    ? resolve(options.assetsPath)
    : fileURLToPath(new URL(`../assets/${runtime === 'cli' ? 'host' : 'wasm'}/`, import.meta.url));
  const entry = join(assets, runtime === 'cli' ? 'MssqlDac.Host.dll' : '_framework/dotnet.js');
  try { await access(entry); }
  catch {
    throw new DacFxError(`DacFx runtime assets are missing at ${entry}. Build the package or supply assetsPath.`, 'ASSETS_MISSING');
  }
  if (options.runtime === 'wasm') return createWasmClient(await loadWasm(pathToFileURL(entry).href));
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new TypeError('timeoutMs must be a positive number no greater than 2147483647.');
  }
  const transport: Transport = request => new Promise((resolveResult, reject) => {
    const child = spawn(options.dotnetPath ?? 'dotnet', [entry], {
      cwd: assets, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DacFxError(`DacFx operation exceeded ${timeoutMs} ms.`, 'TIMEOUT'));
    }, timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      reject(new DacFxError(`Could not start .NET. Install the .NET 8 or newer runtime or set dotnetPath. ${error.message}`, 'HOST_START_FAILED'));
    });
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) {
      stream.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 128 * 1024 * 1024) {
          child.kill('SIGKILL');
          clearTimeout(timer);
          reject(new DacFxError('DacFx response exceeded 128 MiB.', 'OUTPUT_TOO_LARGE'));
        } else chunks.push(chunk);
      });
    }
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new DacFxError(`DacFx host exited with code ${code}. ${Buffer.concat(stderr).toString().trim()}`, 'HOST_FAILED'));
      } else resolveResult(Buffer.concat(stdout).toString());
    });
    // A failed host can close stdin before accepting the request; close/error above reports it.
    child.stdin.on('error', () => {});
    child.stdin.end(request);
  });
  return createClient(transport);
}
