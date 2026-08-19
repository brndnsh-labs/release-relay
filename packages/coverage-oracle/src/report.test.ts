import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { type ScanReportV2, validateReport } from "./report.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const base: ScanReportV2 = {
  reportVersion: 2,
  manifestVersion: 1,
  releaseRelayRevision: "0123456789abcdef0123456789abcdef01234567",
  breakscopeRevision: "fedcba9876543210fedcba9876543210fedcba98",
  ruleset: "breakscope-ruleset@2026-08-19",
  files: [{ file: "src/index.ts", disposition: "scanned" }],
  observations: [
    {
      file: "src/index.ts",
      lineStart: 5,
      lineEnd: 9,
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: "supporting"
    }
  ]
};

function expectInvalid(mutated: unknown, message: string): void {
  const result = validateReport(mutated);
  assert.equal(result.ok, false, `expected validation to fail: ${message}`);
  assert.ok(
    result.errors.some((error) => error.includes(message)),
    `expected an error containing ${JSON.stringify(message)}, got: ${result.errors.join("; ")}`
  );
}

test("a valid v2 report passes", () => {
  const result = validateReport(base);
  assert.ok(result.ok);
  assert.equal(result.report.reportVersion, 2);
  assert.equal(result.report.observations.length, 1);
});

test("unknown report, file, and observation fields are rejected", () => {
  expectInvalid({ ...base, extra: true }, "unknown field extra");
  expectInvalid(
    { ...base, files: [{ ...base.files[0], stray: 1 }] },
    "unknown field stray"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], stray: 1 }] },
    "unknown field stray"
  );
});

test("unsupported report or manifest versions are rejected", () => {
  expectInvalid(
    { ...base, reportVersion: 3 },
    "reportVersion must be the integer 1 or 2"
  );
  expectInvalid(
    { ...base, manifestVersion: 2 },
    "manifestVersion must be the integer 1"
  );
});

test("identity, ruleset, and file dispositions fail closed", () => {
  expectInvalid(
    { ...base, releaseRelayRevision: "b12d651" },
    "full 40-character git commit SHA"
  );
  expectInvalid(
    { ...base, breakscopeRevision: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    "full 40-character git commit SHA"
  );
  expectInvalid({ ...base, ruleset: "" }, "ruleset must be a non-empty string");
  expectInvalid(
    { ...base, files: [{ file: "src/index.ts", disposition: "unknown" }] },
    "disposition must be one of"
  );
  expectInvalid(
    { ...base, files: [{ file: "src/index.ts", disposition: "excluded" }] },
    "reason must be a non-empty string"
  );
  expectInvalid(
    {
      ...base,
      files: [{ file: "src/index.ts", disposition: "scanned", reason: "oops" }]
    },
    "must not be present for disposition scanned"
  );
  expectInvalid(
    { ...base, files: [base.files[0], base.files[0]] },
    "is duplicated in report.files"
  );
});

test("v2 observations require actual valid ranges and fields", () => {
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], provider: "amazon" }] },
    "provider must be one of"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], confidence: "unknown" }] },
    "confidence must be one of"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], lineStart: 0 }] },
    "lineStart must be a positive integer"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], lineEnd: 1.5 }] },
    "lineEnd must be a positive integer"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], lineStart: 10, lineEnd: 9 }]
    },
    "lineStart must be <= lineEnd"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], evidenceKind: "" }] },
    "evidenceKind must be a non-empty string"
  );
  expectInvalid(
    { ...base, observations: [{ ...base.observations[0], anchor: "legacy-anchor" }] },
    "unknown field anchor"
  );
  expectInvalid(
    { ...base, observations: [base.observations[0], base.observations[0]] },
    "duplicates the observation for"
  );
});

test("the staged v1 comparator compatibility validator accepts v1 reports", () => {
  const legacy = {
    ...base,
    reportVersion: 1,
    observations: [
      {
        file: "src/index.ts",
        anchor: "repositoryPhase",
        line: 5,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: "supporting"
      }
    ]
  };
  assert.ok(validateReport(legacy).ok);
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

test("the v2 example report passes through the CLI", () => {
  const example = join(repoRoot, "scenarios/report-v2.example.json");
  const result = runCli(["validate-report", example], repoRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /valid report:/);
});

test("an invalid report is rejected by the CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-report-cli-"));
  try {
    const bad = join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ ...base, releaseRelayRevision: "b12d651" }));
    const result = runCli(["validate-report", bad], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /full 40-character git commit SHA/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
