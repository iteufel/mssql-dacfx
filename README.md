<img src="assets/icon.svg" width="64" height="64" alt="">

# mssql-dacfx

Microsoft SQL Server DacFx for Bun, Node.js, browsers, and module workers. Typed asynchronous APIs for schema validation, DACPAC inspection and creation, and offline deployment scripts/reports. Uses the real `Microsoft.SqlServer.Dac` and `Microsoft.SqlServer.Dac.Model` APIs from **Microsoft.SqlServer.DacFx 170.5.96**.

Inspired by [iteufel/mssql-parser](https://github.com/iteufel/mssql-parser): a shared C# bridge, a precompiled .NET server host, and a separate .NET WebAssembly build. The bridge and TypeScript wrapper here are implemented independently.

| Operation | Bun / Node (.NET host) | WebAssembly (Bun / Node / browser / worker) |
| --- | --- | --- |
| Validate SQL schema, including semantic references | Yes | Yes |
| Inspect DACPAC metadata and object CREATE scripts | Yes | Yes |
| Build DACPAC from SQL files | Yes | Unavailable |
| Generate CREATE / deployment scripts and XML reports | Yes | Unavailable |

The full server API requires **Node.js 22+ or Bun 1.4+** and the **.NET 8 or newer runtime** on PATH. Consumers need no .NET SDK, compilation, native npm addons, or install scripts. WASM requires no installed .NET runtime.

## Install

Builds produce `artifacts/mssql-dacfx-0.1.0.tgz`, installable before registry publication:

```sh
npm install /path/to/mssql-dacfx-0.1.0.tgz
# or
bun add /path/to/mssql-dacfx-0.1.0.tgz
```

After publishing to npm, use `npm install mssql-dacfx` or `bun add mssql-dacfx`.

## Bun / Node.js

```ts
import { writeFile } from 'node:fs/promises';
import { createDacFx } from 'mssql-dacfx';

const dac = await createDacFx();
const files = [
  { name: 'dbo/Items.sql', sql: 'CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY);' },
];

console.log(await dac.validateSql(files, { targetVersion: 'Sql160' }));

const { dacpac, diagnostics } = await dac.buildDacpac(files, {
  name: 'Inventory',
  version: '1.0.0.0',
  targetVersion: 'Sql160', // SQL Server 2022; Sql170 targets SQL Server 2025
});
await writeFile('Inventory.dacpac', dacpac);
console.log(diagnostics);
console.log(await dac.inspectDacpac(dacpac));
console.log(await dac.generateCreateScript(dacpac, { databaseName: 'Inventory' }));
```

SQL inputs can be a single string or an array of `{ name, sql }` files. Names must be unique, ignoring case. Inputs are database object definitions, not arbitrary query batches or SQLCMD scripts. An empty input builds an empty schema. This package does not run MSBuild or evaluate `.sqlproj` files, external project references, or SQLCMD variables.

```ts
const { dacpac: current } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int);');
const { dacpac: desired } = await dac.buildDacpac(
  'CREATE TABLE dbo.Items (Id int, Label nvarchar(100) NULL);',
);
const options = {
  databaseName: 'Inventory',
  deployOptions: { blockOnPossibleDataLoss: true, dropObjectsNotInSource: false },
};

console.log(await dac.generateDeployScript(desired, current, options));
console.log(await dac.generateDeployReport(desired, current, options));
```

The **source is the desired schema**, and the **target is the existing schema**. Operations are offline: they do not connect to or modify a SQL Server database. Scripts can contain SQLCMD directives; execute them with an appropriate tool after review. DacFx also controls which existing DACPAC formats and target platforms it can read.

The host is resolved relative to the installed package, independent of the working directory. For bundled apps, copy the complete `assets/host` folder and set `createDacFx({ assetsPath: '/absolute/path/to/host' })`. Optional `dotnetPath` selects the executable, and `timeoutMs` sets the per-operation timeout (default 120 seconds). Each operation starts an isolated host process; calls do not block the JavaScript event loop.

## WebAssembly

Copy the entire `assets/wasm` directory from the package into your application's static assets, preserving `_framework` and its filenames. Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and `.json` as JSON. Allow the runtime files through your application's CSP. No cross-origin isolation headers are needed.

Browser bundlers select the browser export automatically. An explicit entry works in browsers and module workers:

```ts
import { createDacFx } from 'mssql-dacfx/browser';

const dac = await createDacFx({ assetsPath: '/assets/dacfx' });
console.log(await dac.validateSql('CREATE TABLE dbo.Items (Id int);'));

const bytes = new Uint8Array(await (await fetch('/Inventory.dacpac')).arrayBuffer());
console.log(await dac.inspectDacpac(bytes));
```

Bun and Node can also use the packaged WASM files directly:

```ts
import { createDacFx } from 'mssql-dacfx';
const dac = await createDacFx({ runtime: 'wasm' });
console.log(await dac.validateSql('CREATE TABLE dbo.Items (Id int);'));
```

`WasmDacFx` exposes only `validateSql` and `inspectDacpac`. DacFx's package writer calls `FileVersionInfo.GetVersionInfo` while constructing origin metadata; that API throws `PlatformNotSupportedException` on WASM. Deployment planning waits on monitors, also unsupported by the single-threaded .NET browser runtime. These operations use the server host; this package does not patch Microsoft's assemblies or substitute a different SQL engine.

WASM initialization is shared across concurrent clients at the same asset URL. It lives for the lifetime of the JS realm. Each request disposes its schema model, package, and streams. Operations execute synchronously inside WASM, so use a module worker for large schemas. DacFx is reflection-heavy; trimming is disabled and full globalization data is included. Expect a substantially larger download than a JavaScript parser.

## Errors and API

All methods return promises. `validateSql` returns `{ valid, diagnostics }` for schema errors. `buildDacpac` rejects invalid schemas with `DacFxError` and code `SCHEMA_INVALID`; its `diagnostics` field contains the DacFx messages. Other DacFx failures also reject with `DacFxError`. Source names are retained when available. DacFx validation messages do not always expose source positions; `line` and `column` are `0` when unknown.

```ts
import { DacFxError } from 'mssql-dacfx';
try {
  await dac.buildDacpac('CREATE TABLE (');
} catch (error) {
  if (error instanceof DacFxError) console.error(error.code, error.diagnostics);
  else throw error;
}
```

The full declarations are exported from the package, including `DacFx`, `WasmDacFx`, `SqlFile`, `BuildOptions`, `DeployOptions`, and `PackageInfo`. Available deployment options are `blockOnPossibleDataLoss`, `dropObjectsNotInSource`, `ignorePermissions`, `ignoreRoleMembership`, and `includeCompositeObjects`.

## Development and packaging

Requires Node 22+, npm, Bun 1.4+, the .NET 10.0.402 SDK pinned by `global.json`, and Chromium for the browser checks. A newer .NET runtime can run the bundled host through major-version roll-forward. The build uses the .NET 8 browser runtime; no WASM workload is needed because it does not use AOT or native relinking.

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run test:bun
npx playwright install chromium
npm run test:browser
npm run test:package
```

The package test packs the actual npm tarball, installs it without scripts into a temporary consumer, and runs Bun/Node host and WASM checks from that unrelated working directory. It also verifies the installed browser entry in Chromium and a module worker. `prepack` refuses incomplete builds. There are no npm runtime dependencies.

Publishing runs through [GitHub Actions](https://github.com/iteufel/mssql-project-sql/actions/workflows/publish.yml). Create a GitHub release tagged `vX.Y.Z` matching `package.json`, or dispatch `publish.yml`. The workflow builds and tests the tarball on the runner and publishes it with npm provenance.

For the first publication, dispatch the workflow with `bootstrap=true`. Complete the npm browser sign-in and any publish/trust approvals linked in the job log. The workflow then configures npm trusted publishing for `iteufel/mssql-project-sql` and `publish.yml`, and logs out. Subsequent releases authenticate through OIDC without an npm token secret. If a sign-in link expires, use the newest link from the retry. Publication is never performed by the local build scripts.

## Licenses

The wrapper and bridge are MIT licensed. Microsoft DacFx is proprietary Distributable Code under its own Microsoft license; it is not covered by this repository's MIT license. Bundled .NET and other dependencies retain their respective terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the original files under `licenses/`, generated from the pinned restored packages. This is an independent package, not a Microsoft product.
