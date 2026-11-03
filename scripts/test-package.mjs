import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  if (options.stdio !== 'inherit' && result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}
await mkdir('artifacts', { recursive: true });
const packed = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', 'artifacts']));
const archive = resolve('artifacts', packed[0].filename);
const consumer = await mkdtemp(join(tmpdir(), 'mssql-dacfx-consumer-'));
await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
run(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer });
const exercise = await readFile(new URL('../test/exercise.mjs', import.meta.url), 'utf8');
await writeFile(join(consumer, 'exercise.mjs'), exercise);
await writeFile(join(consumer, 'smoke.mjs'), `import { createDacFx } from 'mssql-dacfx';
import { exercise, exerciseWasm, sql, metadata } from './exercise.mjs';
const cli = await createDacFx();
console.log('cli', await exercise(cli));
const { dacpac } = await cli.buildDacpac(sql, metadata);
console.log('wasm', await exerciseWasm(await createDacFx({ runtime: 'wasm' }), dacpac));
`);
for (const runtime of [process.execPath, 'bun']) {
  console.log(`Testing installed tarball with ${runtime} from ${consumer}`);
  run(runtime, ['smoke.mjs'], { cwd: consumer, stdio: 'inherit', timeout: 180_000 });
}
run(process.execPath, ['scripts/test-browser.mjs', join(consumer, 'node_modules/mssql-dacfx')], { stdio: 'inherit', timeout: 180_000 });
console.log(`Validated npm tarball: ${archive}`);
