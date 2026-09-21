// Best-effort scan of a dbt project's text (dbt_project.yml, profiles.yml,
// models, macros) for `env_var('NAME')` calls, so the sidebar can say which
// variables the active environment is missing before dbt itself fails on
// them. A regex, not a Jinja parser: a call built dynamically is simply not
// seen, which only costs a missed hint.

export interface EnvVarUsages {
  /** Names read with no default -- dbt errors if they are unset. */
  required: string[];
  /** Names read with a default -- fine to leave unset. */
  optional: string[];
}

const ENV_VAR_CALL = /\benv_var\s*\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*(,)?/g;

export function scanEnvVarUsages(sources: string[]): EnvVarUsages {
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const text of sources) {
    for (const match of text.matchAll(ENV_VAR_CALL)) {
      const name = match[2];
      if (name === undefined) {
        continue;
      }
      (match[3] === undefined ? required : optional).add(name);
    }
  }
  for (const name of required) {
    optional.delete(name);
  }
  return { required: [...required].sort(), optional: [...optional].sort() };
}

/** Required names set neither by the resolved environment nor by the
 * real process environment. */
export function findMissingEnvVars(
  usages: EnvVarUsages,
  resolvedEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): string[] {
  return usages.required.filter((name) => !(name in resolvedEnv) && processEnv[name] === undefined);
}
