import type {
  BuildResult, DacFx, Diagnostic, PackageInfo, SqlInput, ValidationResult,
} from './types.js';

export class DacFxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly diagnostics: readonly Diagnostic[] = [],
  ) {
    super(message);
    this.name = 'DacFxError';
  }
}

export type Transport = (request: string) => Promise<string>;

function files(input: SqlInput) {
  if (typeof input === 'string') return [{ name: 'schema.sql', sql: input }];
  if (!Array.isArray(input)) throw new TypeError('Expected SQL text or an array of SQL files.');
  const names = new Set<string>();
  for (const file of input) {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || typeof file.sql !== 'string') {
      throw new TypeError('Each SQL file must have a nonempty name and SQL text.');
    }
    const key = file.name.toLowerCase();
    if (names.has(key)) throw new TypeError(`Duplicate SQL source name: ${file.name}`);
    names.add(key);
  }
  return input;
}

function encode(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected DACPAC bytes as Uint8Array.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

export function createClient(transport: Transport): DacFx {
  async function invoke<T>(operation: string, args: object): Promise<T> {
    const response = JSON.parse(await transport(JSON.stringify({ ...args, operation }))) as
      | { ok: true; result: T }
      | { ok: false; error: { message: string; code: string; diagnostics: Diagnostic[] } };
    if (!response.ok) {
      throw new DacFxError(response.error.message, response.error.code, response.error.diagnostics);
    }
    return response.result;
  }
  return {
    async validateSql(input, options = {}) {
      return invoke<ValidationResult>('validate', { ...options, files: files(input) });
    },
    async buildDacpac(input, options = {}) {
      const result = await invoke<Omit<BuildResult, 'dacpac'> & { dacpac: string }>(
        'build', { ...options, files: files(input) },
      );
      return { ...result, dacpac: decode(result.dacpac) };
    },
    async inspectDacpac(dacpac) {
      return invoke<PackageInfo>('inspect', { dacpac: encode(dacpac) });
    },
    async generateCreateScript(dacpac, options = {}) {
      return invoke<string>('createScript', { ...options, dacpac: encode(dacpac) });
    },
    async generateDeployScript(source, target, options = {}) {
      return invoke<string>('deployScript', { ...options, source: encode(source), target: encode(target) });
    },
    async generateDeployReport(source, target, options = {}) {
      return invoke<string>('deployReport', { ...options, source: encode(source), target: encode(target) });
    },
  };
}
