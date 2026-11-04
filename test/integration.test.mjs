import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDacFx, DacFxError } from '../dist/index.js';
import { exercise } from './exercise.mjs';

for (const runtime of ['cli', 'wasm']) {
  test(`${runtime}: real DacFx integration`, { timeout: 120_000 }, async () => {
    const dac = await createDacFx({ runtime });
    await exercise(dac);
    if (runtime === 'wasm') {
      const second = await createDacFx({ runtime: 'wasm' });
      assert.equal((await second.validateSql('')).valid, true);
    }
    await assert.rejects(dac.validateSql('', { targetVersion: 'invalid' }), DacFxError);
    await assert.rejects(dac.inspectDacpac(new Uint8Array([1, 2, 3])), DacFxError);
    await assert.rejects(dac.validateSql([{ name: 'a.sql', sql: '' }, { name: 'A.sql', sql: '' }]), /Duplicate/);
    assert.equal((await dac.validateSql('')).valid, true);
    for (const targetVersion of ['Sql110', 'Sql120', 'Sql130', 'Sql140', 'Sql150', 'Sql160', 'Sql170', 'SqlAzure', 'SqlDw']) {
      const { dacpac } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int);', { targetVersion });
      assert.equal((await dac.inspectDacpac(dacpac)).targetVersion, targetVersion);
      assert.match(await dac.generateCreateScript(dacpac), /CREATE TABLE \[dbo\]\.\[Items\]/, targetVersion);
    }
    const results = await Promise.all([dac.validateSql('CREATE TABLE dbo.A (Id int);'), dac.validateSql('CREATE TABLE dbo.B (Id int);')]);
    assert.ok(results.every(r => r.valid));
  });
}

test('host startup and asset errors explain how to recover', async () => {
  await assert.rejects(createDacFx({ assetsPath: '/nonexistent-dacfx-assets' }), e => e.code === 'ASSETS_MISSING');
  const dac = await createDacFx({ dotnetPath: '/nonexistent-dacfx-dotnet' });
  await assert.rejects(dac.validateSql(''), e => e.code === 'HOST_START_FAILED');
  await assert.rejects(createDacFx({ timeoutMs: 0 }), /timeoutMs/);
  const timed = await createDacFx({ timeoutMs: 1 });
  await assert.rejects(timed.validateSql(''), e => e.code === 'TIMEOUT');
});

test('native and WASM packages, diagnostics, and deployment plans agree', { timeout: 120_000 }, async () => {
  const native = await createDacFx();
  const wasm = await createDacFx({ runtime: 'wasm' });
  const files = [
    { name: 'view.sql', sql: 'CREATE VIEW dbo.Labels AS SELECT Id, Label FROM dbo.Artikel_Ü;' },
    { name: 'table.sql', sql: 'CREATE TABLE dbo.Artikel_Ü (Id int NOT NULL PRIMARY KEY, Label nvarchar(100) NULL);' },
    { name: 'proc.sql', sql: 'CREATE PROCEDURE dbo.GetLabels AS SELECT * FROM dbo.Labels;' },
  ];
  const options = { name: 'Überblick', version: '2.3.4.5', description: 'Unicode ✓', collation: 'Latin1_General_100_CI_AS' };
  const a = await native.buildDacpac(files, options);
  const b = await wasm.buildDacpac(files, options);
  const info = await native.inspectDacpac(a.dacpac);
  assert.deepEqual(await native.inspectDacpac(b.dacpac), info);
  assert.deepEqual(await wasm.inspectDacpac(a.dacpac), info);
  assert.deepEqual(await wasm.inspectDacpac(b.dacpac), info);
  const normalize = text => text.replaceAll('\r\n', '\n');
  assert.equal(normalize(await wasm.generateCreateScript(b.dacpac)), normalize(await native.generateCreateScript(a.dacpac)));
  const [oldNative, oldWasm] = await Promise.all([native.buildDacpac(''), wasm.buildDacpac('')]);
  for (const method of ['generateDeployScript', 'generateDeployReport']) {
    assert.equal(normalize(await wasm[method](b.dacpac, oldWasm.dacpac)), normalize(await native[method](a.dacpac, oldNative.dacpac)));
  }
  const invalid = [{ name: 'bad.sql', sql: 'CREATE VIEW dbo.Bad AS SELECT * FROM dbo.Missing;' }];
  assert.deepEqual(await wasm.validateSql(invalid), await native.validateSql(invalid));
});

test('WASM needs no installed .NET and exits naturally after concurrent requests', { timeout: 60_000 }, () => {
  const entry = new URL('../dist/index.js', import.meta.url).href;
  const code = `import assert from 'node:assert/strict';
import { createDacFx } from ${JSON.stringify(entry)};
const worker = globalThis.Worker;
const [a, b] = await Promise.all([createDacFx({runtime:'wasm'}), createDacFx({runtime:'wasm'})]);
const [first, second] = await Promise.all([a.buildDacpac('CREATE TABLE dbo.A(Id int);'), b.buildDacpac('CREATE TABLE dbo.B(Id int);')]);
assert.match(await a.generateCreateScript(first.dacpac), /CREATE TABLE \\[dbo\\]\\.\\[A\\]/);
assert.match(await b.generateCreateScript(second.dacpac), /CREATE TABLE \\[dbo\\]\\.\\[B\\]/);
assert.equal(globalThis.Worker, worker);
console.log('WASM completed');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 45_000, env: { ...process.env, PATH: '' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /WASM completed/);
});
