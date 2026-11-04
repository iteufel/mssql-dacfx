import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { generateNotices } from './notices.mjs';
import { prepareWasm } from './prepare-wasm.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
await rm('dist', { recursive: true, force: true });
await rm('assets/host', { recursive: true, force: true });
await rm('assets/wasm', { recursive: true, force: true });
await rm('artifacts/wasm', { recursive: true, force: true });
// Static-web-asset manifests can retain stale compressed files after SDK changes.
for (const project of ['Host', 'Wasm', 'Compatibility']) {
  await rm(`dotnet/${project}/bin`, { recursive: true, force: true });
  await rm(`dotnet/${project}/obj`, { recursive: true, force: true });
}
await mkdir('assets', { recursive: true });
run('dotnet', ['build', 'dotnet/Compatibility/MssqlDac.FileVersionInfo.csproj', '-c', 'Release', '--nologo', '-p:RestoreLockedMode=true', '-m:1', '-nr:false']);
run('dotnet', ['publish', 'dotnet/Host/MssqlDac.Host.csproj', '-c', 'Release', '-o', 'assets/host', '--nologo', '-p:UseAppHost=false', '-p:RestoreLockedMode=true', '-m:1', '-nr:false']);
run('dotnet', ['publish', 'dotnet/Wasm/MssqlDac.Wasm.csproj', '-c', 'Release', '-o', 'artifacts/wasm', '--nologo', '-p:RestoreLockedMode=true', '-m:1', '-nr:false']);
await cp('artifacts/wasm/wwwroot/_framework', 'assets/wasm/_framework', { recursive: true });
// Compression belongs to the serving layer; npm already compresses the tarball.
await removeCompressed('assets/wasm');
await prepareWasm('assets/wasm/_framework');
async function removeCompressed(directory) {
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await removeCompressed(path);
    else if (/\.(br|gz)$/.test(entry.name)) await rm(path);
  }
}
await generateNotices();
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
run(process.execPath, ['scripts/check-package.mjs']);
