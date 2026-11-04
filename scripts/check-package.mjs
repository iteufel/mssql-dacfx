import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
for (const file of [
  'dist/index.js', 'dist/browser.js', 'dist/index.d.ts',
  'assets/host/MssqlDac.Host.dll', 'assets/host/MssqlDac.Host.runtimeconfig.json',
  'assets/host/Microsoft.SqlServer.Dac.dll', 'assets/wasm/_framework/dotnet.js',
  'assets/wasm/_framework/blazor.boot.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'assets/wasm/_framework/dotnet.native.worker.js',
  'assets/wasm/_framework/mssql-node-worker.mjs',
  'assets/wasm/_framework/System.Diagnostics.FileVersionInfo.dll',
  'licenses/Microsoft.SqlServer.DacFx-170.5.96/license.txt',
]) {
  try { await access(file); }
  catch { throw new Error(`Package is incomplete: ${file} is missing. Run npm run build first.`); }
}
const browser = await readFile('dist/browser.js', 'utf8');
if (browser.includes('node:')) throw new Error('The browser entry imports Node built-ins.');
const boot = JSON.parse(await readFile('assets/wasm/_framework/blazor.boot.json', 'utf8'));
for (const group of ['assembly', 'jsModuleNative', 'jsModuleRuntime', 'jsModuleWorker', 'wasmNative']) {
  if (!boot.resources[group]) throw new Error(`Missing WASM resources: ${group}`);
  for (const [name, expected] of Object.entries(boot.resources[group])) {
    const bytes = await readFile(`assets/wasm/_framework/${name}`);
    const actual = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
    if (expected !== actual) throw new Error(`WASM integrity mismatch: ${name}. Rebuild the package.`);
  }
}
console.error('Package assets and licenses verified.');
