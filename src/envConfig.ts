// Resolves the environment variables the extension passes to every `zhao`
// (and so dbt) process it spawns. Pure: file contents and the process env
// come in as data, the merged environment plus its provenance and
// diagnostics come out -- no VS Code API, no filesystem, so the whole
// precedence story is unit-testable against synthetic inputs.

import { parse as parseDotenv } from "dotenv";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { isAbsolute, join } from "node:path";

export interface EnvInputs {
  /** The workspace folder `envFile` paths resolve against. */
  workspaceDir: string;
  /** Text of `.vscode/zhao.json`, or `null` when the file doesn't exist. */
  zhaoJson: string | null;
  /** Text of `.vscode/zhao-secret.json`, or `null` when it doesn't exist. */
  secretJson: string | null;
  /** Reads a resolved (absolute) `.env` path, `null` when missing. */
  readEnvFile: (absolutePath: string) => string | null;
  /** The named set currently selected in the sidebar, if any. */
  activeSet: string | null;
  processEnv: Record<string, string | undefined>;
}

export interface EnvSource {
  kind: "zhao.json" | "zhao-secret.json" | "env-file";
  /** The named set the value came from; `null` for the flat base. */
  set: string | null;
  /** For `env-file`: the path as written in `zhao.json`. */
  file?: string;
}

export interface ShadowedValue {
  value: string;
  source: EnvSource;
}

export interface ResolvedVariable {
  name: string;
  /** The expanded value the process will see. */
  value: string;
  /** The value exactly as configured (e.g. `${env:DB_PASSWORD}`) -- what
   * the sidebar shows and edits, so a passthrough reference is never
   * replaced by the secret it points at. */
  raw: string;
  source: EnvSource;
  /** `true` for values that live in `zhao-secret.json`. */
  secret: boolean;
  /** Lower-precedence definitions this one overrides, highest first. */
  shadows: ShadowedValue[];
  /** `true` when `value` still holds an unexpandable `${...}` reference,
   * so the variable is left out of `ResolvedEnv.env`. */
  unresolved: boolean;
}

export interface ResolvedEnv {
  /** Only the configured variables -- callers layer it over the real
   * process environment, which is the lowest-precedence source. */
  env: Record<string, string>;
  variables: ResolvedVariable[];
  availableSets: string[];
  /** Every `.env` file considered (absolute paths), including missing
   * ones -- so callers can watch them and check their git status. */
  envFiles: string[];
  diagnostics: EnvDiagnostic[];
}

export interface EnvDiagnostic {
  severity: "error" | "warning";
  message: string;
}

interface RawSet {
  env?: Record<string, unknown>;
  envFile?: unknown;
}

interface RawEnvFile extends RawSet {
  sets?: Record<string, RawSet>;
}

interface Layer {
  source: EnvSource;
  vars: Record<string, string>;
}

function parseConfig(text: string | null, file: string, diagnostics: EnvDiagnostic[]): RawEnvFile {
  if (text === null || text.trim() === "") {
    return {};
  }
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push({ severity: "error", message: `${file} is not valid JSON.` });
    return {};
  }
  return parsed as RawEnvFile;
}

function stringVars(
  env: Record<string, unknown> | undefined,
  file: string,
  diagnostics: EnvDiagnostic[],
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") {
      vars[name] = value;
    } else {
      diagnostics.push({ severity: "error", message: `${file}: ${name} must be a string.` });
    }
  }
  return vars;
}

const SECRET_NAME = /(^|_)(PASSWORD|PASSWD|TOKEN|SECRET|KEY)$/i;

/** Names that look like credentials -- masked in the sidebar even when
 * they live in a file (or `.env`) that carries no secret flag of its own. */
export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

function envFilePaths(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Precedence, lowest to highest (the real process env sits below all of
 * these and is layered by the caller): zhao.json base, secret base,
 * zhao.json active set, secret active set, base `envFile`s, active set
 * `envFile`s. `.env` files deliberately win over every JSON value. */
export function resolveEnv(inputs: EnvInputs): ResolvedEnv {
  const diagnostics: EnvDiagnostic[] = [];
  const zhao = parseConfig(inputs.zhaoJson, "zhao.json", diagnostics);
  const secret = parseConfig(inputs.secretJson, "zhao-secret.json", diagnostics);
  const activeSet = inputs.activeSet;
  const vars = (file: "zhao.json" | "zhao-secret.json", env: Record<string, unknown> | undefined) =>
    stringVars(env, file, diagnostics);

  const layers: Layer[] = [
    { source: { kind: "zhao.json", set: null }, vars: vars("zhao.json", zhao.env) },
    { source: { kind: "zhao-secret.json", set: null }, vars: vars("zhao-secret.json", secret.env) },
  ];
  if (activeSet !== null) {
    layers.push(
      { source: { kind: "zhao.json", set: activeSet }, vars: vars("zhao.json", zhao.sets?.[activeSet]?.env) },
      { source: { kind: "zhao-secret.json", set: activeSet }, vars: vars("zhao-secret.json", secret.sets?.[activeSet]?.env) },
    );
  }

  const envFiles: string[] = [];
  const envFileLayers = (set: string | null, value: unknown): Layer[] =>
    envFilePaths(value).flatMap((file) => {
      const absolute = isAbsolute(file) ? file : join(inputs.workspaceDir, file);
      envFiles.push(absolute);
      const text = inputs.readEnvFile(absolute);
      if (text === null) {
        diagnostics.push({ severity: "warning", message: `envFile ${file} was not found.` });
        return [];
      }
      return [{ source: { kind: "env-file", set, file } as EnvSource, vars: parseDotenv(text) }];
    });
  layers.push(...envFileLayers(null, zhao.envFile));
  if (activeSet !== null) {
    layers.push(...envFileLayers(activeSet, zhao.sets?.[activeSet]?.envFile));
  }

  const definitions = new Map<string, { winner: ShadowedValue; shadows: ShadowedValue[] }>();
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer.vars)) {
      const entry: ShadowedValue = { value, source: layer.source };
      const existing = definitions.get(name);
      definitions.set(
        name,
        existing ? { winner: entry, shadows: [existing.winner, ...existing.shadows] } : { winner: entry, shadows: [] },
      );
    }
  }

  const raw = new Map<string, string>();
  const literals = new Set<string>();
  for (const [name, { winner }] of definitions) {
    raw.set(name, winner.value);
    if (winner.source.kind === "env-file") {
      literals.add(name);
    }
  }
  const expansions = expandReferences(raw, literals, inputs.processEnv, diagnostics);

  const variables: ResolvedVariable[] = [];
  const env: Record<string, string> = {};
  for (const [name, { winner, shadows }] of definitions) {
    const overridden = shadows.find((s) => s.source.kind !== "env-file" && s.value !== winner.value);
    if (winner.source.kind === "env-file" && overridden) {
      diagnostics.push({
        severity: "warning",
        message: `${name} is also set in ${describeSource(overridden.source)} but ${winner.source.file} wins.`,
      });
    }
    const expanded = expansions.get(name) ?? null;
    if (winner.source.kind === "zhao.json" && isSecretName(name) && !REFERENCE_TEST.test(winner.value)) {
      diagnostics.push({
        severity: "warning",
        message: `${name} looks like a secret but is stored as a literal in zhao.json; put it in zhao-secret.json or use a \${env:...} reference.`,
      });
    }
    variables.push({
      name,
      value: expanded ?? winner.value,
      raw: winner.value,
      source: winner.source,
      secret: winner.source.kind === "zhao-secret.json" || isSecretName(name),
      shadows,
      unresolved: expanded === null,
    });
    if (expanded !== null) {
      env[name] = expanded;
    }
  }

  const availableSets = [...new Set([...Object.keys(zhao.sets ?? {}), ...Object.keys(secret.sets ?? {})])];
  return { env, variables, availableSets, envFiles, diagnostics };
}

const REFERENCE_TEST = /\$\{(env:)?[A-Za-z_][A-Za-z0-9_]*\}/;
const REFERENCE = /\$\{(env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Expands `${env:NAME}` (from the process env) and `${NAME}` (from
 * another configured variable) in every value. A value that can't be
 * fully expanded maps to `null` and adds a diagnostic. */
function expandReferences(
  raw: Map<string, string>,
  literals: Set<string>,
  processEnv: Record<string, string | undefined>,
  diagnostics: EnvDiagnostic[],
): Map<string, string | null> {
  const done = new Map<string, string | null>();
  const inProgress = new Set<string>();

  const expand = (name: string): string | null => {
    if (done.has(name)) {
      return done.get(name) ?? null;
    }
    if (inProgress.has(name)) {
      diagnostics.push({ severity: "error", message: `${name} is part of a reference cycle.` });
      return null;
    }
    if (literals.has(name)) {
      done.set(name, raw.get(name) ?? "");
      return done.get(name) ?? null;
    }
    inProgress.add(name);
    let failed = false;
    const value = (raw.get(name) ?? "").replace(REFERENCE, (_match, isEnv: string | undefined, target: string) => {
      const replacement = isEnv ? processEnv[target] : raw.has(target) ? expand(target) : undefined;
      if (replacement === undefined || replacement === null) {
        failed = true;
        if (isEnv || !raw.has(target)) {
          diagnostics.push({
            severity: "warning",
            message: `${name} refers to ${isEnv ? "${env:" : "${"}${target}}, which is not set.`,
          });
        }
        return "";
      }
      return replacement;
    });
    inProgress.delete(name);
    const result = failed ? null : value;
    done.set(name, result);
    return result;
  };

  for (const name of raw.keys()) {
    expand(name);
  }
  return done;
}

function describeSource(source: EnvSource): string {
  const file = source.kind === "env-file" ? (source.file ?? ".env") : source.kind;
  return source.set === null ? file : `${file} (${source.set})`;
}
