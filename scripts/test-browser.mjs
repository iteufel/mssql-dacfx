import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.argv[2] ?? '.');
const exercise = await readFile(new URL('../test/exercise.mjs', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    // Threaded .NET uses SharedArrayBuffer, including inside module workers.
    if (pathname !== '/unisolated') {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (pathname === '/' || pathname === '/unisolated') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>DacFx package integration test</title>');
      return;
    }
    if (pathname === '/exercise.mjs') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(exercise); return;
    }
    if (pathname === '/worker.mjs') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`import { createDacFx } from '/dist/browser.js';
import { exercise } from '/exercise.mjs';
const errors = [];
console.error = (...args) => errors.push(args.map(String).join(' '));
try { postMessage({ result: await exercise(await createDacFx({ assetsPath: '/assets/wasm' })) }); }
catch (error) { postMessage({ error: errors.join('\\n') + '\\n' + (error.stack || String(error)) }); }`);
      return;
    }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser;
let timer;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
  page.setDefaultTimeout(120_000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await Promise.race([page.evaluate(async () => {
    const { createDacFx } = await import('/dist/browser.js');
    const { exercise } = await import('/exercise.mjs');
    const [a, b] = await Promise.all([
      createDacFx({ assetsPath: '/assets/wasm' }), createDacFx({ assetsPath: '/assets/wasm' }),
    ]);
    const main = await exercise(a);
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
  }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser checks exceeded 120 seconds')), 120_000); })]);
  clearTimeout(timer);
  console.log('Chromium and module worker:', result);
  await page.goto(`http://127.0.0.1:${server.address().port}/unisolated`);
  const unavailable = await page.evaluate(async () => {
    const { createDacFx } = await import('/dist/browser.js');
    try { await createDacFx({ assetsPath: '/assets/wasm' }); return null; }
    catch (error) { return { code: error.code, message: error.message }; }
  });
  if (unavailable?.code !== 'WASM_THREADS_UNAVAILABLE' || !unavailable.message.includes('Cross-Origin-Opener-Policy')) {
    throw new Error('A page without isolation headers must receive an actionable threading error.');
  }
} finally {
  clearTimeout(timer);
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
