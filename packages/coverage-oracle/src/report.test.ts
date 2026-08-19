import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateReport, type ScanReport } from "./report.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const base: ScanReport = {
  reportVersion: 1,
  manifestVersion: 1,
  releaseRelayRevision: "0123456789abcdef0123456789abcdef01234567",
  breakscopeRevision: "fedcba9876543210fedcba9876543210fedcba98",
  ruleset: "breakscope-ruleset@2026-08-19",
  files: [{ file: "src/index.ts", disposition: "scanned" }],
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

function expectInvalid(mutated: unknown, message: string): void {
  const result = validateReport(mutated);
  assert.equal(result.ok, false, `expected validation to fail: ${message}`);
  assert.ok(
    result.errors.some((error) => error.includes(message)),
    `expected an error containing ${JSON.stringify(message)}, got: ${result.errors.join("; ")}`
  );
}

test("a valid report passes", () => {
  const result = validateReport(base);
  assert.ok(result.ok);
  assert.equal(result.report.observations.length, 1);
});

test("unknown report fields are rejected", () => {
  expectInvalid({ ...base, extra: true }, "unknown field extra");
});

test("unknown file and observation fields are rejected", () => {
  expectInvalid(
    { ...base, files: [{ ...base.files[0], stray: 1 }] },
    "unknown field stray"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], stray: 1 }]
    },
    "unknown field stray"
  );
});

test("non-v1 report or manifest versions are rejected", () => {
  expectInvalid({ ...base, reportVersion: 2 }, "reportVersion must be the integer 1");
  expectInvalid(
    { ...base, manifestVersion: 2 },
    "manifestVersion must be the integer 1"
  );
});

test("short or malformed SHAs are rejected", () => {
  expectInvalid(
    { ...base, releaseRelayRevision: "b12d651" },
    "full 40-character git commit SHA"
  );
  expectInvalid(
    { ...base, breakscopeRevision: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    "full 40-character git commit SHA"
  );
});

test("empty ruleset is rejected", () => {
  expectInvalid({ ...base, ruleset: "" }, "ruleset must be a non-empty string");
  expectInvalid({ ...base, ruleset: "   " }, "ruleset must be a non-empty string");
});

test("invalid file dispositions are rejected", () => {
  expectInvalid(
    { ...base, files: [{ file: "src/index.ts", disposition: "unknown" }] },
    "disposition must be one of"
  );
});

test("excluded files require a reason and scanned files forbid one", () => {
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
});

test("duplicate file entries are rejected", () => {
  expectInvalid(
    { ...base, files: [base.files[0], base.files[0]] },
    "is duplicated in report.files"
  );
});

test("invalid observation fields are rejected", () => {
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], provider: "amazon" }]
    },
    "provider must be one of"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], confidence: "unknown" }]
    },
    "confidence must be one of"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], line: 0 }]
    },
    "line must be a positive integer"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], line: 1.5 }]
    },
    "line must be a positive integer"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], evidenceKind: "" }]
    },
    "evidenceKind must be a non-empty string"
  );
});

test("anchors containing provider names or URLs are rejected", () => {
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], anchor: "github-call" }]
    },
    "anchor must not contain the provider name github"
  );
  expectInvalid(
    {
      ...base,
      observations: [{ ...base.observations[0], anchor: "https://example.com" }]
    },
    "anchor must not contain an endpoint URL"
  );
});

test("duplicate observation keys are rejected", () => {
  expectInvalid(
    { ...base, observations: [base.observations[0], base.observations[0]] },
    "duplicates the observation for"
  );
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

test("the example report passes through the CLI", () => {
  const example = join(repoRoot, "scenarios/report-v1.example.json");
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
