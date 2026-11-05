// Validate trusted publishing before spending time building the release.
// Tokens stay in memory; npm obtains its own short-lived token when publishing.
import { readFile } from 'node:fs/promises';

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!requestUrl || !requestToken) {
  throw new Error('Trusted publishing requires a GitHub Actions job with id-token: write.');
}
const url = new URL(requestUrl);
url.searchParams.set('audience', 'npm:registry.npmjs.org');
const identityResponse = await fetch(url, {
  headers: { Authorization: `Bearer ${requestToken}` },
  signal: AbortSignal.timeout(30_000),
});
if (!identityResponse.ok) {
  throw new Error(`GitHub OIDC identity request failed (HTTP ${identityResponse.status}).`);
}
const { value: identity } = await identityResponse.json();
if (!identity) throw new Error('GitHub returned no OIDC identity.');
const response = await fetch(`https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${identity}` },
  signal: AbortSignal.timeout(30_000),
});
const body = await response.json();
if (!response.ok || !body.token) {
  // Print only the registry's diagnostic, never credentials or the full response.
  const message = typeof body.message === 'string' ? body.message.slice(0, 1000) : 'No diagnostic supplied';
  throw new Error(`npm trusted-publisher authentication failed (HTTP ${response.status}): ${message}`);
}
console.log(`npm trusted-publisher authentication succeeded for ${name}.`);
