import { access, readFile } from 'node:fs/promises';
for (const file of [
  'dist/index.js', 'dist/browser.js', 'dist/index.d.ts',
  'assets/host/MssqlDac.Host.dll', 'assets/host/MssqlDac.Host.runtimeconfig.json',
  'assets/host/Microsoft.SqlServer.Dac.dll', 'assets/wasm/_framework/dotnet.js',
  'assets/wasm/_framework/blazor.boot.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'licenses/Microsoft.SqlServer.DacFx-170.5.96/license.txt',
]) {
  try { await access(file); }
  catch { throw new Error(`Package is incomplete: ${file} is missing. Run npm run build first.`); }
}
const browser = await readFile('dist/browser.js', 'utf8');
if (browser.includes('node:')) throw new Error('The browser entry imports Node built-ins.');
console.error('Package assets and licenses verified.');
