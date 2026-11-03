import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { sql, metadata } from '../test/exercise.mjs';

const root = resolve(process.argv[2] ?? '.');
const { createDacFx } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const { dacpac } = await (await createDacFx()).buildDacpac(sql, metadata);
const exercise = await readFile(new URL('../test/exercise.mjs', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>DacFx package integration test</title>');
      return;
    }
    if (pathname === '/fixture.dacpac') { response.end(dacpac); return; }
    if (pathname === '/exercise.mjs') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(exercise); return;
    }
    if (pathname === '/worker.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`import { createDacFx } from '/dist/browser.js';
import { exerciseWasm } from '/exercise.mjs';
try { postMessage({ result: await exerciseWasm(await createDacFx({ assetsPath: '/assets/wasm' }), new Uint8Array(await (await fetch('/fixture.dacpac')).arrayBuffer())) }); }
catch (error) { postMessage({ error: error.stack || String(error) }); }`);
      return;
    }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const { createDacFx } = await import('/dist/browser.js');
    const { exerciseWasm } = await import('/exercise.mjs');
    const [a, b] = await Promise.all([
      createDacFx({ assetsPath: '/assets/wasm' }), createDacFx({ assetsPath: '/assets/wasm' }),
    ]);
    const main = await exerciseWasm(a, new Uint8Array(await (await fetch('/fixture.dacpac')).arrayBuffer()));
    if (!(await b.validateSql('')).valid) throw new Error('Shared runtime initialization failed');
    const worker = await new Promise((resolve, reject) => {
      const worker = new Worker('/worker.mjs', { type: 'module' });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker timed out')); }, 120_000);
      worker.onmessage = event => {
        clearTimeout(timer); worker.terminate();
        event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
      };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    });
    return { main, worker };
  });
  console.log('Chromium and module worker:', result);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
