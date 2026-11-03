import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDacFx, DacFxError } from '../dist/index.js';
import { exercise, exerciseWasm, sql, metadata } from './exercise.mjs';

for (const runtime of ['cli', 'wasm']) {
  test(`${runtime}: real DacFx integration`, { timeout: 120_000 }, async () => {
    const dac = await createDacFx({ runtime });
    if (runtime === 'cli') await exercise(dac);
    else {
      const cli = await createDacFx();
      const { dacpac } = await cli.buildDacpac(sql, metadata);
      await exerciseWasm(dac, dacpac);
      assert.equal('buildDacpac' in dac, false, 'WASM must not expose unsupported operations');
      const second = await createDacFx({ runtime: 'wasm' });
      assert.equal((await second.validateSql('')).valid, true);
    }
    await assert.rejects(dac.validateSql('', { targetVersion: 'invalid' }), DacFxError);
    await assert.rejects(dac.inspectDacpac(new Uint8Array([1, 2, 3])), DacFxError);
    await assert.rejects(dac.validateSql([{ name: 'a.sql', sql: '' }, { name: 'A.sql', sql: '' }]), /Duplicate/);
    assert.equal((await dac.validateSql('')).valid, true);
    for (const targetVersion of ['Sql110', 'Sql120', 'Sql130', 'Sql140', 'Sql150', 'Sql160', 'Sql170', 'SqlAzure', 'SqlDw']) {
      assert.equal((await dac.validateSql('CREATE TABLE dbo.Items (Id int);', { targetVersion })).valid, true, targetVersion);
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
