<img src="assets/icon.svg" width="64" height="64" alt="">

# mssql-dacfx

Microsoft SQL Server DacFx for **Bun, Node.js, browsers, and module workers**. Validate SQL schemas, build and inspect DACPACs, and generate offline deployment scripts and reports with the real **Microsoft.SqlServer.DacFx 170.5.96** engine.

**All six package operations work in WebAssembly.** WASM runs locally and requires no installed .NET runtime, native addon, SQL Server connection, or remote service. A separate .NET host is also available for server applications.

Inspired by [iteufel/mssql-parser](https://github.com/iteufel/mssql-parser). The TypeScript wrapper and C# bridge are implemented independently.

| Operation | WASM: Bun / Node / browser / worker | .NET host: Bun / Node |
| --- | --- | --- |
| Validate SQL syntax and semantic references | Yes | Yes |
| Build a DACPAC from SQL definitions | Yes | Yes |
| Inspect package metadata and object scripts | Yes | Yes |
| Generate a database CREATE script | Yes | Yes |
| Generate a deployment script between packages | Yes | Yes |
| Generate an XML deployment report | Yes | Yes |

## Install

```sh
npm install mssql-dacfx
# or
bun add mssql-dacfx
```

Use **Node.js 22+ or Bun 1.4+**. The package is ESM and includes TypeScript declarations, prebuilt runtime assets, and dependency licenses. It has no npm runtime dependencies or installation scripts.

## Bun and Node.js: use WASM

```ts
import { writeFile } from 'node:fs/promises';
import { createDacFx } from 'mssql-dacfx';

const dac = await createDacFx({ runtime: 'wasm' });
const files = [
  { name: 'dbo/Items.sql', sql: 'CREATE TABLE dbo.Items (Id int NOT NULL PRIMARY KEY);' },
];

console.log(await dac.validateSql(files, { targetVersion: 'Sql160' }));

const { dacpac, diagnostics } = await dac.buildDacpac(files, {
  name: 'Inventory',
  version: '1.0.0.0',
  description: 'Inventory schema',
  targetVersion: 'Sql160',
});
await writeFile('Inventory.dacpac', dacpac);
console.log(diagnostics);
console.log(await dac.inspectDacpac(dacpac));
console.log(await dac.generateCreateScript(dacpac, { databaseName: 'Inventory' }));
```

The packaged WASM assets are located relative to the installed module, independently of the working directory. For bundled server apps, copy the entire `assets/wasm` directory and pass its absolute filesystem path as `assetsPath`.

### Plan a schema change

```ts
const { dacpac: current } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int);');
const { dacpac: desired } = await dac.buildDacpac(
  'CREATE TABLE dbo.Items (Id int, Label nvarchar(100) NULL);',
);
const options = {
  databaseName: 'Inventory',
  deployOptions: { blockOnPossibleDataLoss: true, dropObjectsNotInSource: false },
};

const sql = await dac.generateDeployScript(desired, current, options);
const reportXml = await dac.generateDeployReport(desired, current, options);
```

The **source is the desired schema** and the **target is the existing schema**. These calls generate output; they do not connect to or modify a database. DacFx can put SQLCMD directives and data-loss guards in generated SQL. Run it with a suitable deployment tool after review.

### Select the .NET host

```ts
const dac = await createDacFx(); // equivalent to { runtime: 'cli' }
```

The default remains the .NET host for compatibility with 0.1. It exposes the same API and requires **.NET 8 or newer** on PATH. Consumers do not need a .NET SDK. Each operation runs in an isolated child process.

Host options are `dotnetPath` (executable path or name), `timeoutMs` (per-operation timeout, default `120000`), and `assetsPath` (directory containing `MssqlDac.Host.dll` and its dependencies). The host limits combined stdout/stderr to 128 MiB. These options do not configure the WASM runtime.

## Browsers

Copy **the complete `node_modules/mssql-dacfx/assets/wasm` directory** into your static assets, for example as `/assets/dacfx`. Preserve `_framework` and every filename, including `.dll`, `.mjs`, and worker files.

Threaded .NET requires `SharedArrayBuffer`. Serve your HTML document, application workers, and runtime assets over HTTPS (or localhost) with:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Check `globalThis.crossOriginIsolated === true` in the browser. Serve `.wasm` as `application/wasm`, `.js`/`.mjs` as JavaScript, `.json` as JSON, and `.dll` as binary data. Your content security policy must allow module loading, workers, and WebAssembly compilation. If assets are on another origin, configure CORS/CORP consistently with your isolation policy.

```ts
import { createDacFx } from 'mssql-dacfx/browser';

const dac = await createDacFx({ assetsPath: '/assets/dacfx' });
const { dacpac } = await dac.buildDacpac('CREATE TABLE dbo.Items (Id int);');
console.log(await dac.inspectDacpac(dacpac));
console.log(await dac.generateCreateScript(dacpac));
```

Browser bundlers can also select the browser export from `mssql-dacfx` automatically. `assetsPath` is required in browsers and resolves against the document or worker URL. Missing threading support rejects initialization with `DacFxError.code === 'WASM_THREADS_UNAVAILABLE'` and explains the required headers.

### Module workers

Bundle this worker entry with your application and serve it with the isolation headers above:

```js
// dacfx-worker.mjs
import { createDacFx } from 'mssql-dacfx/browser';

const ready = createDacFx({ assetsPath: '/assets/dacfx' });
self.onmessage = async ({ data }) => {
  try {
    const result = await (await ready).buildDacpac(data.sql);
    self.postMessage({ id: data.id, result }, [result.dacpac.buffer]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
```

Create it with `new Worker(new URL('./dacfx-worker.mjs', import.meta.url), { type: 'module' })`. A worker is useful for large schemas because input/output encoding and initialization still do work in the caller's JS realm. Terminating your application worker releases its runtime.

## API reference

Every method returns a promise. `DacFx` and `WasmDacFx` describe the same six methods.

| Method | Result |
| --- | --- |
| `validateSql(input, modelOptions?)` | `{ valid, diagnostics }` |
| `buildDacpac(input, buildOptions?)` | `{ dacpac: Uint8Array, diagnostics }` |
| `inspectDacpac(dacpac)` | `{ name, version, description, targetVersion, objects }` |
| `generateCreateScript(dacpac, scriptOptions?)` | SQL string |
| `generateDeployScript(source, target, scriptOptions?)` | SQL string |
| `generateDeployReport(source, target, scriptOptions?)` | XML string |

### SQL inputs and target platforms

`input` is a SQL string or an array of `{ name, sql }` files. File names must be nonempty and unique, ignoring case. Separate multiple object definitions in one string with `GO`, or supply one object per file. Empty input represents an empty schema.

These are schema definitions, rather than arbitrary query batches. The package does not evaluate `.sqlproj` files, run MSBuild, resolve external project references, substitute SQLCMD variables, or expose DacFx's live database deployment/extraction APIs. It is an offline API wrapper, not a binding for every public member of the DacFx assemblies.

Model options are `targetVersion` and `collation`. Build options also accept `name` (default `Database`), `version` (default `1.0.0.0`, two to four numeric components), and `description` (default empty).

| `targetVersion` | Platform |
| --- | --- |
| `Sql110` / `Sql120` / `Sql130` | SQL Server 2012 / 2014 / 2016 |
| `Sql140` / `Sql150` / `Sql160` | SQL Server 2017 / 2019 / 2022 |
| `Sql170` | SQL Server 2025 |
| `SqlAzure` | Azure SQL Database |
| `SqlDw` | Azure Synapse dedicated SQL pool |

The default is `Sql160`. DacFx validates syntax and features against the selected platform. Not every SQL construct is valid on every target.

### Package inspection and deployment options

`objects` contains user-defined named objects with `{ name, type, script }`, sorted by name and type. Names use SQL identifier notation such as `[dbo].[Items]`. `script` is `null` when DacFx cannot provide an object script.

Script options accept `databaseName` (default `Database`) and `deployOptions`. All these deployment options are available in both runtimes:

| Deployment option | Default | Effect |
| --- | --- | --- |
| `blockOnPossibleDataLoss` | `true` | Include DacFx safeguards for changes that might lose data |
| `dropObjectsNotInSource` | `false` | Drop target objects absent from the source |
| `ignorePermissions` | `false` | Ignore permission differences |
| `ignoreRoleMembership` | `false` | Ignore role membership differences |
| `includeCompositeObjects` | `false` | Include composite objects from packages that contain them |

DacFx determines compatibility when reading existing DACPAC formats or comparing packages targeting different platforms.

### Diagnostics and errors

`validateSql` returns schema errors as diagnostics. `buildDacpac` rejects an invalid schema with `DacFxError` and code `SCHEMA_INVALID`. Diagnostics contain `code`, `severity`, `message`, `sourceName`, `line`, and `column`. Source names are retained where available; unavailable positions are `0`.

```ts
import { DacFxError } from 'mssql-dacfx';

try {
  await dac.buildDacpac('CREATE TABLE (');
} catch (error) {
  if (error instanceof DacFxError) console.error(error.code, error.diagnostics);
  else throw error;
}
```

Other engine failures reject with `DacFxError`; invalid JavaScript argument shapes can throw `TypeError`. A failed request does not prevent subsequent requests on the same WASM client.

## How the WASM build works

The C# bridge calls the same public DacFx APIs in both runtimes. WASM uses the pinned **.NET 8.0.33 multithreaded browser runtime**. Calls execute on .NET background threads, allowing DacFx's internal task waits to complete. Requests sharing an asset URL are queued, and concurrent initialization reuses one runtime per JS realm. Idle WASM clients do not keep a Bun/Node process alive.

Two compatibility adaptations make the offline API work:

- A small MIT-licensed `FileVersionInfo` replacement reads real version attributes from loaded managed assemblies. DacFx uses these when writing package origin metadata; the stock browser implementation throws.
- The build adapts the MIT-licensed .NET JavaScript loader for module workers, Node/Bun worker messages and transferred ports, and hosting the runtime inside an application worker. Build-time checks require the pinned runtime and expected patch sites, and verify asset integrity hashes.

**Microsoft's DacFx assemblies are not patched.** No operation falls back to the native host or an HTTP service. .NET's upstream WASM threading support remains experimental; the package tests its pinned compatibility build on Node, Bun, Chromium, and a Chromium module worker. See the [.NET threading documentation](https://github.com/dotnet/runtime/blob/v8.0.0/src/mono/wasm/threads.md).

Trimming is disabled because DacFx relies on reflection. Full globalization data is included. Expect a larger download and memory footprint than a JavaScript SQL parser. The runtime remains allocated until its JS realm exits.

### Upgrading from 0.1

WASM now exposes package creation and all script/report methods. Existing browser deployments must add the cross-origin isolation headers and deploy the entire updated assets directory. `WasmDacFx` is now an alias for the full `DacFx` interface. The default Bun/Node runtime remains `cli`.

## Build, test, and publish

Development requires Node 22+, npm, Bun 1.4+, the **.NET 10.0.403 SDK** pinned in `global.json`, and Chromium. No WASM workload is needed: builds use the precompiled interpreter runtime, without AOT or native relinking.

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run test:bun
npx playwright install --no-shell chromium
npm run test:browser
npm run test:package
```

Tests cover all six operations, all exposed target versions, deployment options, invalid input, package interchange with native DacFx, concurrent requests, and a WASM-only process with no .NET executable on PATH. Browser tests exercise both a page and a module worker. `test:package` installs the actual npm tarball without scripts into a temporary consumer and tests Bun, Node, and browser entries from that location. `prepack` verifies runtime assets, hashes, and licenses.

Publishing runs only through [GitHub Actions](https://github.com/iteufel/mssql-dacfx/actions/workflows/publish.yml). Publish a GitHub release tagged `vX.Y.Z` matching `package.json`, or dispatch `publish.yml`. The workflow checks npm authentication, then builds and tests the package before publishing with npm provenance. Normal releases use OIDC without an npm token secret. Configure the trusted publisher for `iteufel/mssql-dacfx`, workflow `publish.yml`, with direct publishing allowed and no GitHub environment. The workflow's `bootstrap` input is reserved for publishing a new package and creating its first trusted publisher.

A new trusted publisher must complete its first successful OIDC publish within two days. If that window expires, dispatch `publish.yml` with `bootstrap=false` and `replace_trust_id` set to the expired publisher's ID from npm settings. Approve the browser links in the workflow's sign-in and publisher-replacement steps. Sign-in, trust replacement, logout, and publication all run on the GitHub-hosted runner; no local npm login or publish is needed. The workflow removes the recovery login before checking OIDC and publishing, so the release validates the new trusted publisher. Creating a publisher after a bootstrap release does not itself validate OIDC: run the next version through trusted publishing within that window. The early authentication check reports registry failures before the build; an OIDC `package not found` response can indicate a missing or invalid trust configuration even when the package is public. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup and expiration rules.

## Licenses

The wrapper, bridge, and compatibility code are MIT licensed. Microsoft DacFx is proprietary Distributable Code under its own Microsoft license; it is not covered by this repository's MIT license. Bundled .NET and other dependencies retain their terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the original files under `licenses/`, generated from pinned restored packages. This is an independent package, not a Microsoft product.
