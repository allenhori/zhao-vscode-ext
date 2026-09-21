import { describe, expect, it } from "vitest";
import { isSecretName, resolveEnv, type EnvInputs } from "./envConfig.js";

/** Builds inputs with everything absent unless a test says otherwise, so
 * each test states only the files it cares about. */
function inputs(overrides: Partial<EnvInputs> = {}): EnvInputs {
  return {
    workspaceDir: "/ws",
    zhaoJson: null,
    secretJson: null,
    readEnvFile: () => null,
    activeSet: null,
    processEnv: {},
    ...overrides,
  };
}

describe("resolveEnv: flat env in zhao.json", () => {
  it("returns the flat env variables", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "DBT_THREADS": "4", "SF_ACCOUNT": "abc" } }' }));

    expect(resolved.env).toEqual({ DBT_THREADS: "4", SF_ACCOUNT: "abc" });
    expect(resolved.diagnostics).toEqual([]);
  });

  it("returns an empty env when there is no config at all", () => {
    expect(resolveEnv(inputs()).env).toEqual({});
  });

  it("reads JSON with comments and trailing commas", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{\n  // which account\n  "env": { "SF_ACCOUNT": "abc", },\n}' }),
    );

    expect(resolved.env).toEqual({ SF_ACCOUNT: "abc" });
  });

  it("reports where each variable came from", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "A": "1" } }' }));

    expect(resolved.variables).toMatchObject([{ name: "A", value: "1", source: { kind: "zhao.json", set: null } }]);
  });
});

describe("resolveEnv: named sets", () => {
  const zhaoJson = JSON.stringify({
    env: { DBT_THREADS: "4", SF_ACCOUNT: "base" },
    sets: {
      "client-a": { env: { SF_ACCOUNT: "acme" } },
      "client-b": { env: { SF_ACCOUNT: "globex", EXTRA: "b-only" } },
    },
  });

  it("layers the active set over the flat base", () => {
    const resolved = resolveEnv(inputs({ zhaoJson, activeSet: "client-a" }));

    expect(resolved.env).toEqual({ DBT_THREADS: "4", SF_ACCOUNT: "acme" });
  });

  it("ignores every set when none is active", () => {
    expect(resolveEnv(inputs({ zhaoJson })).env).toEqual({ DBT_THREADS: "4", SF_ACCOUNT: "base" });
  });

  it("only applies the active set's variables", () => {
    const resolved = resolveEnv(inputs({ zhaoJson, activeSet: "client-a" }));

    expect(resolved.env).not.toHaveProperty("EXTRA");
  });

  it("lists the available set names", () => {
    expect(resolveEnv(inputs({ zhaoJson })).availableSets).toEqual(["client-a", "client-b"]);
  });

  it("marks the shadowed base value on the winning variable", () => {
    const resolved = resolveEnv(inputs({ zhaoJson, activeSet: "client-a" }));
    const account = resolved.variables.find((v) => v.name === "SF_ACCOUNT");

    expect(account?.source).toEqual({ kind: "zhao.json", set: "client-a" });
    expect(account?.shadows).toEqual([{ value: "base", source: { kind: "zhao.json", set: null } }]);
  });
});

describe("resolveEnv: zhao-secret.json", () => {
  it("layers the secret file over zhao.json at the same level", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "env": { "TOKEN": "public", "A": "1" } }',
        secretJson: '{ "env": { "TOKEN": "s3cret" } }',
      }),
    );

    expect(resolved.env).toEqual({ TOKEN: "s3cret", A: "1" });
  });

  it("flags values that came from the secret file as secret", () => {
    const resolved = resolveEnv(inputs({ secretJson: '{ "env": { "TOKEN": "s3cret" } }' }));

    expect(resolved.variables[0]).toMatchObject({ name: "TOKEN", secret: true });
  });

  it("ranks the active set of zhao.json above the secret flat base", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "sets": { "a": { "env": { "X": "set-value" } } } }',
        secretJson: '{ "env": { "X": "secret-base" } }',
        activeSet: "a",
      }),
    );

    expect(resolved.env.X).toBe("set-value");
  });

  it("applies the secret file's active set above zhao.json's active set", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "sets": { "a": { "env": { "X": "public-set" } } } }',
        secretJson: '{ "sets": { "a": { "env": { "X": "secret-set" } } } }',
        activeSet: "a",
      }),
    );

    expect(resolved.env.X).toBe("secret-set");
  });
});

describe("resolveEnv: references", () => {
  it("resolves ${env:NAME} from the process environment", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{ "env": { "PW": "${env:MY_SF_PASSWORD}" } }', processEnv: { MY_SF_PASSWORD: "hunter2" } }),
    );

    expect(resolved.env).toEqual({ PW: "hunter2" });
  });

  it("expands references embedded in longer text", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{ "env": { "URL": "https://${env:HOST}/db" } }', processEnv: { HOST: "example.com" } }),
    );

    expect(resolved.env.URL).toBe("https://example.com/db");
  });

  it("resolves ${OTHER} from another configured variable", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{ "env": { "BASE": "/data", "OUT": "${BASE}/out" } }' }),
    );

    expect(resolved.env.OUT).toBe("/data/out");
  });

  it("leaves an unresolved passthrough out of the env and reports it", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "PW": "${env:NOPE}" } }' }));

    expect(resolved.env).toEqual({});
    expect(resolved.variables[0]).toMatchObject({ name: "PW", unresolved: true });
    expect(resolved.diagnostics).toEqual([
      { severity: "warning", message: expect.stringContaining("NOPE") },
    ]);
  });

  it("reports a reference cycle instead of looping", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "A": "${B}", "B": "${A}" } }' }));

    expect(resolved.env).toEqual({});
    expect(resolved.diagnostics.some((d) => d.severity === "error" && d.message.includes("cycle"))).toBe(true);
  });

  it("resolves a reference to a name defined only in the active set", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "env": { "OUT": "${ACCT}-out" }, "sets": { "a": { "env": { "ACCT": "acme" } } } }',
        activeSet: "a",
      }),
    );

    expect(resolved.env.OUT).toBe("acme-out");
  });
});

describe("resolveEnv: .env files", () => {
  const files: Record<string, string> = {
    "/ws/.env": "SF_ACCOUNT=from-dotenv\nDBT_THREADS=8\n",
    "/ws/.env.client-a": "SF_ACCOUNT=client-a-dotenv\n",
    "/ws/.env.second": "SF_ACCOUNT=second\n",
  };
  const readEnvFile = (path: string): string | null => files[path] ?? null;

  it("loads variables from a relative envFile, resolved against the workspace", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "envFile": ".env" }', readEnvFile }));

    expect(resolved.env).toEqual({ SF_ACCOUNT: "from-dotenv", DBT_THREADS: "8" });
    expect(resolved.variables[0]?.source).toEqual({ kind: "env-file", set: null, file: ".env" });
  });

  it("gives .env precedence over JSON values with the same name", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "envFile": ".env", "env": { "SF_ACCOUNT": "from-json" } }',
        secretJson: '{ "env": { "SF_ACCOUNT": "from-secret" } }',
        readEnvFile,
      }),
    );

    expect(resolved.env.SF_ACCOUNT).toBe("from-dotenv");
  });

  it("warns specifically when .env overrides a different JSON value", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "envFile": ".env", "env": { "SF_ACCOUNT": "from-json" } }',
        readEnvFile,
      }),
    );

    expect(resolved.diagnostics).toEqual([
      {
        severity: "warning",
        message: expect.stringMatching(/SF_ACCOUNT.*zhao\.json.*\.env wins/),
      },
    ]);
  });

  it("does not warn when the values agree", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{ "envFile": ".env", "env": { "DBT_THREADS": "8" } }', readEnvFile }),
    );

    expect(resolved.diagnostics).toEqual([]);
  });

  it("applies a named set's envFile only while that set is active, above the base envFile", () => {
    const zhaoJson = JSON.stringify({
      envFile: ".env",
      sets: { "client-a": { envFile: ".env.client-a" } },
    });

    expect(resolveEnv(inputs({ zhaoJson, readEnvFile })).env.SF_ACCOUNT).toBe("from-dotenv");
    expect(resolveEnv(inputs({ zhaoJson, readEnvFile, activeSet: "client-a" })).env.SF_ACCOUNT).toBe(
      "client-a-dotenv",
    );
  });

  it("lets later entries in an envFile array win", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "envFile": [".env", ".env.second"] }', readEnvFile }));

    expect(resolved.env.SF_ACCOUNT).toBe("second");
  });

  it("warns about a missing envFile and carries on", () => {
    const resolved = resolveEnv(
      inputs({ zhaoJson: '{ "envFile": ".env.nope", "env": { "A": "1" } }', readEnvFile }),
    );

    expect(resolved.env).toEqual({ A: "1" });
    expect(resolved.diagnostics).toEqual([
      { severity: "warning", message: expect.stringContaining(".env.nope") },
    ]);
  });

  it("does not expand ${...} inside .env values", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "envFile": ".env" }',
        readEnvFile: () => "PW=abc${def}ghi\n",
      }),
    );

    expect(resolved.env.PW).toBe("abc${def}ghi");
  });

  it("lists every envFile it considered as an absolute path, even a missing one", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "envFile": [".env", "/abs/.env"], "sets": { "a": { "envFile": "conf/a.env" } } }',
        readEnvFile,
        activeSet: "a",
      }),
    );

    expect(resolved.envFiles).toEqual(["/ws/.env", "/abs/.env", "/ws/conf/a.env"]);
  });

  it("accepts an absolute envFile path as-is", () => {
    const resolved = resolveEnv(
      inputs({
        zhaoJson: '{ "envFile": "/elsewhere/.env" }',
        readEnvFile: (path) => (path === "/elsewhere/.env" ? "X=1\n" : null),
      }),
    );

    expect(resolved.env).toEqual({ X: "1" });
  });
});

describe("resolveEnv: validation", () => {
  it("reports a non-string value and skips just that variable", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "A": "1", "B": 2 } }' }));

    expect(resolved.env).toEqual({ A: "1" });
    expect(resolved.diagnostics).toEqual([
      { severity: "error", message: expect.stringMatching(/B.*string/) },
    ]);
  });

  it("reports unparseable JSON and yields an empty env", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": ' }));

    expect(resolved.env).toEqual({});
    expect(resolved.diagnostics).toEqual([
      { severity: "error", message: expect.stringContaining("zhao.json") },
    ]);
  });

  it("names the secret file when that is the broken one", () => {
    const resolved = resolveEnv(inputs({ secretJson: "not json at all" }));

    expect(resolved.diagnostics[0]?.message).toContain("zhao-secret.json");
  });
});

describe("isSecretName", () => {
  it.each(["SF_PASSWORD", "GITHUB_TOKEN", "API_KEY", "DB_SECRET", "snowflake_password"])(
    "treats %s as secret",
    (name) => expect(isSecretName(name)).toBe(true),
  );

  it.each(["SF_ACCOUNT", "DBT_THREADS", "KEYSPACE", "TOKENIZER_MODE"])("does not treat %s as secret", (name) =>
    expect(isSecretName(name)).toBe(false),
  );

  it("flags matching names as secret even when they come from zhao.json", () => {
    const resolved = resolveEnv(inputs({ zhaoJson: '{ "env": { "SF_PASSWORD": "x", "SF_ACCOUNT": "y" } }' }));

    expect(resolved.variables.map((v) => [v.name, v.secret])).toEqual([
      ["SF_PASSWORD", true],
      ["SF_ACCOUNT", false],
    ]);
  });
});
