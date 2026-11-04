import { readFile, writeFile, copyFile, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const runtimeVersion = '8.0.33';
const runtimePackage = 'Microsoft.NETCore.App.Runtime.Mono.multithread.browser-wasm';
const hash = bytes => `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

/** Adapt the pinned, MIT-licensed .NET runtime. Never rewrite DacFx assemblies. */
export async function prepareWasm(directory) {
  const assets = JSON.parse(await readFile('dotnet/Wasm/obj/project.assets.json', 'utf8'));
  const dependency = assets.project.frameworks['net8.0'].downloadDependencies.find(item => item.name === runtimePackage);
  if (dependency?.version !== `[${runtimeVersion}, ${runtimeVersion}]`) {
    throw new Error('The WASM runtime changed. Review the compatibility adapters before updating the pin.');
  }
  let native;
  for (const root of Object.keys(assets.packageFolders)) {
    const candidate = join(root, runtimePackage.toLowerCase(), runtimeVersion, 'runtimes/browser-wasm/native');
    try { await access(candidate); native = candidate; break; } catch {}
  }
  if (!native) throw new Error('The restored threaded WASM runtime is missing.');

  const bootPath = join(directory, 'blazor.boot.json');
  const boot = JSON.parse(await readFile(bootPath, 'utf8'));
  // The .NET 10 SDK does not include the .NET 8 thread worker in its manifest.
  await copyFile(join(native, 'dotnet.native.worker.js'), join(directory, 'dotnet.native.worker.js'));
  boot.resources.jsModuleWorker = { 'dotnet.native.worker.js': '' };

  const workerPrelude = `var require, __filename;
if (typeof process === 'object' && process.versions?.node) {
  require = (await import('node:module')).createRequire(import.meta.url);
  __filename = (await import('node:url')).fileURLToPath(import.meta.url);
}
`;
  const workerFactory = `const Worker = typeof process === 'object' && process.versions?.node
  ? (await import('./mssql-node-worker.mjs')).Worker
  : class extends globalThis.Worker {
      constructor(url, options) { super(url, { ...options, type: 'module' }); }
    };
`;
  const edits = {
    'dotnet.js': source => replaceOnce(source,
      /\(\w+\|\|\w+\)&&\w+\(!1,"This build of dotnet is multi-threaded,[^"]*"\),/g, ''),
    'dotnet.runtime.js': source => workerFactory + source,
    // Keep the worker constructor local instead of overwriting the consumer's global.
    'dotnet.native.js': source => replaceOnce(replaceOnce(source,
      'global.Worker=nodeWorkerThreads.Worker', 'var Worker=nodeWorkerThreads.Worker'),
      // A runtime hosted by an application's worker still owns its primary JS
      // thread. Only .NET-created pthreads use the secondary-thread attach path.
      '__emscripten_thread_init(tb,!ENVIRONMENT_IS_WORKER,1,!ENVIRONMENT_IS_WEB)',
      '__emscripten_thread_init(tb,!ENVIRONMENT_IS_PTHREAD,1,!ENVIRONMENT_IS_WEB)'),
    'dotnet.native.worker.js': source => workerPrelude + replaceOnce(source,
      'postMessage:function(msg){parentPort.postMessage(msg)}',
      'postMessage:function(msg,transfer){parentPort.postMessage(msg,transfer)}'),
  };
  for (const [file, edit] of Object.entries(edits)) {
    const source = await readFile(join(native, file), 'utf8');
    const code = edit(source);
    await writeFile(join(directory, file), code);
    for (const resource of Object.values(boot.resources)) {
      if (resource && typeof resource === 'object' && Object.hasOwn(resource, file)) resource[file] = hash(code);
    }
  }
  await copyFile('scripts/runtime/node-worker.mjs', join(directory, 'mssql-node-worker.mjs'));

  // Replace only the unsupported BCL version reader, using our managed metadata adapter.
  const name = 'System.Diagnostics.FileVersionInfo';
  const bytes = await readFile(`dotnet/Compatibility/bin/Release/net8.0/${name}.dll`);
  await writeFile(join(directory, `${name}.dll`), bytes);
  await rm(join(directory, `${name}.wasm`), { force: true });
  delete boot.resources.assembly[`${name}.wasm`];
  boot.resources.assembly[`${name}.dll`] = hash(bytes);
  delete boot.resources.hash;
  boot.resources.hash = hash(JSON.stringify(boot.resources));
  await writeFile(bootPath, `${JSON.stringify(boot, null, 2)}\n`);
}

function replaceOnce(source, search, replacement) {
  const count = typeof search === 'string' ? source.split(search).length - 1 : [...source.matchAll(search)].length;
  if (count !== 1) throw new Error(`Expected one compatibility patch site, found ${count}: ${search}`);
  return source.replace(search, replacement);
}
