function check(condition, message) { if (!condition) throw new Error(message); }
export const sql = 'CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY);';
export const metadata = { name: 'Example', version: '1.2.3.4', description: 'Round trip' };

/** Shared WASM contract: real model validation and a CLI-produced DACPAC. */
export async function exerciseWasm(dac, dacpac) {
  const valid = await dac.validateSql(sql);
  check(valid.valid && valid.diagnostics.length === 0, 'Expected a valid schema');
  const invalid = await dac.validateSql([{ name: 'broken.sql', sql: 'CREATE TABLE dbo.Bad (Id NOT_A_TYPE);' }]);
  check(!invalid.valid && invalid.diagnostics.some(d => d.severity === 'error'), 'Expected schema diagnostics');
  const syntax = await dac.validateSql('CREATE TABLE (');
  check(!syntax.valid && syntax.diagnostics.length > 0, 'Expected syntax diagnostics');
  const info = await dac.inspectDacpac(dacpac);
  check(info.name === 'Example' && info.version === '1.2.3.4' && info.description === 'Round trip', 'Package metadata was lost');
  check(info.objects.some(o => o.name === '[dbo].[Items]' && o.type === 'Table' && o.script?.includes('CREATE TABLE')), 'Table script is missing');
  return { bytes: dacpac.length, objects: info.objects.length };
}

/** Full CLI contract includes package writing and offline deployment planning. */
export async function exercise(dac) {
  let rejected = false;
  try { await dac.buildDacpac('CREATE TABLE ('); }
  catch (error) { rejected = error.code === 'SCHEMA_INVALID' && error.diagnostics.length > 0; }
  check(rejected, 'Invalid SQL must not produce a DACPAC');
  const { dacpac: target } = await dac.buildDacpac(sql, metadata);
  check(target instanceof Uint8Array && target[0] === 80 && target[1] === 75, 'Expected a ZIP DACPAC');
  const result = await exerciseWasm(dac, target);
  const create = await dac.generateCreateScript(target, { databaseName: 'Example' });
  check(create.includes('CREATE TABLE [dbo].[Items]'), 'CREATE script is missing the table');
  const { dacpac: source } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY, Label nvarchar(100) NULL);');
  const script = await dac.generateDeployScript(source, target, { databaseName: 'Example' });
  check(script.includes('ALTER TABLE [dbo].[Items]') && script.includes('[Label]'), 'Expected an ADD column migration');
  const report = await dac.generateDeployReport(source, target);
  check(report.includes('DeploymentReport') && report.includes('Items'), 'Expected an XML deployment report');
  return result;
}
