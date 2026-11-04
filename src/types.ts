/** SQL Server 2012–2025 and Azure SQL targets understood by the pinned DacFx. */
export type SqlServerVersion =
  | 'Sql110' | 'Sql120' | 'Sql130' | 'Sql140' | 'Sql150' | 'Sql160' | 'Sql170'
  | 'SqlAzure' | 'SqlDw';

export interface SqlFile {
  /** Unique source name used in diagnostics, for example dbo/Items.sql. */
  name: string;
  sql: string;
}

export type SqlInput = string | readonly SqlFile[];

export interface ModelOptions {
  /** Defaults to SQL Server 2022 (Sql160). */
  targetVersion?: SqlServerVersion;
  collation?: string;
}

export interface BuildOptions extends ModelOptions {
  name?: string;
  /** Two to four numeric components, for example 1.0.0.0. */
  version?: string;
  description?: string;
}

export interface Diagnostic {
  code: number;
  severity: 'error' | 'warning' | 'message';
  message: string;
  sourceName: string | null;
  /** One-based where available; 0 or -1 indicates an unknown location. */
  line: number;
  column: number;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
}

export interface BuildResult {
  dacpac: Uint8Array;
  diagnostics: Diagnostic[];
}

export interface SchemaObject {
  name: string;
  type: string;
  script: string | null;
}

export interface PackageInfo {
  name: string;
  version: string;
  description: string | null;
  targetVersion: SqlServerVersion;
  objects: SchemaObject[];
}

export interface DeployOptions {
  /** Defaults to true. */
  blockOnPossibleDataLoss?: boolean;
  /** Defaults to false. */
  dropObjectsNotInSource?: boolean;
  ignorePermissions?: boolean;
  ignoreRoleMembership?: boolean;
  includeCompositeObjects?: boolean;
}

export interface ScriptOptions {
  /** Defaults to Database. Used only in the generated script/report. */
  databaseName?: string;
  deployOptions?: DeployOptions;
}

/** All operations are offline. The source package is the desired schema. */
export interface DacFx {
  validateSql(input: SqlInput, options?: ModelOptions): Promise<ValidationResult>;
  inspectDacpac(dacpac: Uint8Array): Promise<PackageInfo>;
  buildDacpac(input: SqlInput, options?: BuildOptions): Promise<BuildResult>;
  generateCreateScript(dacpac: Uint8Array, options?: ScriptOptions): Promise<string>;
  generateDeployScript(source: Uint8Array, target: Uint8Array, options?: ScriptOptions): Promise<string>;
  generateDeployReport(source: Uint8Array, target: Uint8Array, options?: ScriptOptions): Promise<string>;
}

/** The WebAssembly runtime supports the same operations as the native host. */
export type WasmDacFx = DacFx;

export interface WasmOptions {
  /** Directory containing _framework. Required in browsers; file path in Bun/Node. */
  assetsPath?: string;
}

export interface CliOptions {
  runtime?: 'cli';
  /** Directory containing MssqlDac.Host.dll and its dependencies. */
  assetsPath?: string;
  /** Executable name or path, without arguments. Defaults to dotnet. */
  dotnetPath?: string;
  /** Per-operation timeout. Defaults to 120000 milliseconds. */
  timeoutMs?: number;
}

export type InitOptions = CliOptions | (WasmOptions & { runtime: 'wasm' });
