import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSourceAnchors } from "./anchors.js";
import { validateManifest, type OracleManifest } from "./schema.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const scenario = {
  id: "bootstrap-phase",
  purpose: "Example scenario for the validator.",
  source: { file: "src/index.ts", anchor: "repositoryPhase" },
  expectations: [
    {
      outcome: "observation",
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: "supporting"
    }
  ],
  rationale: "Example rationale.",
  reviewedBy: "maintainer",
  reviewedAt: "2026-08-18"
} satisfies OracleManifest["scenarios"][number];

const expectation = scenario.expectations[0];

const base: OracleManifest = {
  version: 1,
  revision: "0123456789abcdef0123456789abcdef01234567",
  scenarios: [scenario]
};

function withScenario(mutatedScenario: unknown): unknown {
  return { ...base, scenarios: [mutatedScenario] };
}

function expectInvalid(mutated: unknown, message: string): void {
  const result = validateManifest(mutated);
  assert.equal(result.ok, false, `expected validation to fail: ${message}`);
  assert.ok(
    result.errors.some((error) => error.includes(message)),
    `expected an error containing ${JSON.stringify(message)}, got: ${result.errors.join("; ")}`
  );
}

test("a valid manifest passes", () => {
  const result = validateManifest(base);
  assert.ok(result.ok);
  assert.equal(result.manifest.scenarios.length, 1);
});

test("unknown manifest fields are rejected", () => {
  expectInvalid({ ...base, extra: true }, "unknown field extra");
});

test("unknown scenario and source fields are rejected", () => {
  expectInvalid(
    withScenario({ ...scenario, unexpected: 1 }),
    "unknown field unexpected"
  );
  expectInvalid(
    withScenario({ ...scenario, source: { ...scenario.source, stray: 1 } }),
    "unknown field stray"
  );
});

test("unknown expectation fields are rejected", () => {
  expectInvalid(
    withScenario({ ...scenario, expectations: [{ ...expectation, stray: 1 }] }),
    "unknown field stray"
  );
});

test("duplicate scenario ids are rejected", () => {
  expectInvalid(
    { ...base, scenarios: [scenario, scenario] },
    "is duplicated across scenarios"
  );
});

test("duplicate anchors are rejected", () => {
  const second = { ...scenario, id: "second-scenario" };
  expectInvalid(
    { ...base, scenarios: [scenario, second] },
    "is duplicated across scenarios"
  );
});

test("invalid providers are rejected", () => {
  expectInvalid(
    withScenario({
      ...scenario,
      expectations: [{ ...expectation, provider: "amazon" }]
    }),
    "provider must be one of"
  );
});

test("outcome-incompatible fields are rejected", () => {
  expectInvalid(
    withScenario({
      ...scenario,
      expectations: [{ ...expectation, reason: "not allowed here" }]
    }),
    "reason must not be present for outcome observation"
  );
  expectInvalid(
    withScenario({
      ...scenario,
      expectations: [{ ...expectation, confidence: "none" }]
    }),
    "confidence none is incompatible with outcome observation"
  );
  expectInvalid(
    withScenario({
      ...scenario,
      expectations: [{ outcome: "excluded", confidence: "none" }]
    }),
    "reason is required for outcome excluded"
  );
  expectInvalid(
    withScenario({
      ...scenario,
      expectations: [{ outcome: "uncertain", confidence: "none", provider: "github" }]
    }),
    "provider must not be present for outcome uncertain"
  );
});

test("missing rationale and review data are rejected", () => {
  const noRationale = structuredClone(scenario) as Record<string, unknown>;
  delete noRationale.rationale;
  expectInvalid(withScenario(noRationale), "rationale must be a non-empty string");

  const noReviewer = structuredClone(scenario) as Record<string, unknown>;
  delete noReviewer.reviewedBy;
  expectInvalid(withScenario(noReviewer), "reviewedBy must be a non-empty string");

  const noDate = structuredClone(scenario) as Record<string, unknown>;
  delete noDate.reviewedAt;
  expectInvalid(withScenario(noDate), "reviewedAt must be a YYYY-MM-DD date");

  expectInvalid(
    withScenario({ ...scenario, reviewedAt: "2026-13-40" }),
    "reviewedAt must be a YYYY-MM-DD date"
  );
});

test("short or malformed revision SHAs are rejected", () => {
  expectInvalid({ ...base, revision: "b12d651" }, "full 40-character git commit SHA");
  expectInvalid(
    { ...base, revision: "gggggggggggggggggggggggggggggggggggggggg" },
    "full 40-character git commit SHA"
  );
});

test("non-v1 versions are rejected", () => {
  expectInvalid({ ...base, version: 2 }, "version must be the integer 1");
});

test("anchors containing provider names are rejected", () => {
  expectInvalid(
    withScenario({
      ...scenario,
      source: { file: "src/index.ts", anchor: "github-call" }
    }),
    "anchor must not contain the provider name github"
  );
});

test("source anchors must resolve to exactly one occurrence", async () => {
  assert.deepEqual(await checkSourceAnchors(base, repoRoot), []);

  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-"));
  try {
    const file = "sample.ts";
    await writeFile(
      join(dir, file),
      "export const once = true;\nexport const twice = true;\n"
    );
    const once = { ...scenario, source: { file, anchor: "once" } };
    const missing = { ...scenario, source: { file, anchor: "absent" } };
    const duplicated = { ...scenario, source: { file, anchor: "true" } };
    assert.deepEqual(await checkSourceAnchors({ ...base, scenarios: [once] }, dir), []);
    assert.match(
      (await checkSourceAnchors({ ...base, scenarios: [missing] }, dir))[0] ?? "",
      /not found/
    );
    assert.match(
      (await checkSourceAnchors({ ...base, scenarios: [duplicated] }, dir))[0] ?? "",
      /expected exactly one/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runCli(
  args: string[],
  cwd: string
): { status: number; stdout: string; stderr: string } {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

test("the example manifest passes through the CLI", () => {
  const example = join(repoRoot, "scenarios/oracle-v1.example.json");
  const result = runCli(["validate", example, "--source-root", repoRoot], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /valid:/);
});

test("an invalid manifest is rejected by the CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-cli-"));
  try {
    const bad = join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ ...base, revision: "b12d651" }));
    const result = runCli(["validate", bad, "--source-root", repoRoot], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /full 40-character git commit SHA/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
