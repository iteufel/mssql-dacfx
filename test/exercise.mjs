function check(condition, message) { if (!condition) throw new Error(message); }
export const sql = 'CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY);';
export const metadata = { name: 'Example', version: '1.2.3.4', description: 'Round trip' };

/** Validation and package inspection, shared by every environment. */
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

/** Every runtime must build packages and plan deployments with the same API. */
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
  await exerciseOptions(dac);
  return result;
}

async function exerciseOptions(dac) {
  const currentSql = [
    'CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY, Legacy nvarchar(10) NULL);',
    'CREATE TABLE dbo.Unused (Id int);',
  ].join('\nGO\n');
  const { dacpac: current } = await dac.buildDacpac(currentSql);
  const { dacpac: desired } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY);');
  const safe = await dac.generateDeployScript(desired, current);
  check(safe.includes('data loss might occur') && !safe.includes('DROP TABLE'), 'Default deployment safeguards were lost');
  const drop = await dac.generateDeployScript(desired, current, {
    deployOptions: { blockOnPossibleDataLoss: false, dropObjectsNotInSource: true, includeCompositeObjects: true },
  });
  check(drop.includes('DROP TABLE [dbo].[Unused]') && !drop.includes('data loss might occur'), 'Deployment options were ignored');

  const { dacpac: security } = await dac.buildDacpac([
    currentSql, 'CREATE ROLE app_role;', 'CREATE USER app_user WITHOUT LOGIN;',
    'ALTER ROLE app_role ADD MEMBER app_user;', 'GRANT SELECT ON dbo.Items TO app_role;',
  ].join('\nGO\n'));
  const permissions = await dac.generateDeployScript(security, current);
  check(permissions.includes('GRANT SELECT') && permissions.includes('sp_addrolemember'), 'Permissions or role membership were lost');
  const ignored = await dac.generateDeployScript(security, current, {
    deployOptions: { ignorePermissions: true, ignoreRoleMembership: true },
  });
  check(!ignored.includes('GRANT SELECT') && !ignored.includes('sp_addrolemember'), 'Security deployment options were ignored');
}
