import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { type ComparisonReport, compareReports } from "./compare.js";
import { type ScanReportV1, validateReport } from "./report.js";
import { type OracleManifest, validateManifest } from "./schema.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const REVISION = "0123456789abcdef0123456789abcdef01234567";
const BREAKSCOPE_REVISION = "fedcba9876543210fedcba9876543210fedcba98";
const RULESET = "breakscope-ruleset@2026-08-19";

const SOURCES: Record<string, string> = {
  "observed.ts":
    "export const first = 1;\n// observed-anchor\nexport const second = 2;\n",
  "quiet.ts": "export const first = 1;\n// quiet-anchor\nexport const second = 2;\n",
  "demoted.ts":
    "export const first = 1;\n// demoted-anchor\nexport const second = 2;\n",
  "generated.ts":
    "export const first = 1;\n// generated-anchor\nexport const second = 2;\n",
  "dynamic.ts": "export const first = 1;\n// dynamic-anchor\nexport const second = 2;\n"
};

function git(cwd: string, args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : ""
  };
}

function baseScenario(
  id: string,
  file: string,
  anchor: string,
  expectations: OracleManifest["scenarios"][number]["expectations"]
): OracleManifest["scenarios"][number] {
  return {
    id,
    purpose: `Test scenario ${id}.`,
    source: { file, anchor },
    expectations,
    rationale: "Test rationale.",
    reviewedBy: "maintainer",
    reviewedAt: "2026-08-19"
  };
}

function baseManifest(): OracleManifest {
  return {
    version: 1,
    revision: REVISION,
    scenarios: [
      baseScenario("observed-scenario", "observed.ts", "observed-anchor", [
        {
          outcome: "observation",
          provider: "github",
          identifier: "repos.list",
          evidenceKind: "sdk-call",
          confidence: "supporting"
        }
      ]),
      baseScenario("quiet-scenario", "quiet.ts", "quiet-anchor", [
        {
          outcome: "no-observation",
          provider: "openai",
          identifier: "responses.create",
          confidence: "none"
        }
      ]),
      baseScenario("demoted-scenario", "demoted.ts", "demoted-anchor", [
        {
          outcome: "demoted",
          provider: "stripe",
          identifier: "balance.retrieve",
          evidenceKind: "sdk-call",
          confidence: "demoted"
        }
      ]),
      baseScenario("generated-scenario", "generated.ts", "generated-anchor", [
        { outcome: "excluded", confidence: "none", reason: "generated source path" }
      ]),
      baseScenario("dynamic-scenario", "dynamic.ts", "dynamic-anchor", [
        { outcome: "uncertain", confidence: "none" }
      ])
    ]
  };
}

function baseReport(): ScanReportV1 {
  return {
    reportVersion: 1,
    manifestVersion: 1,
    releaseRelayRevision: REVISION,
    breakscopeRevision: BREAKSCOPE_REVISION,
    ruleset: RULESET,
    files: [
      { file: "observed.ts", disposition: "scanned" },
      { file: "quiet.ts", disposition: "scanned" },
      { file: "demoted.ts", disposition: "scanned" },
      {
        file: "generated.ts",
        disposition: "excluded",
        reason: "generated source path"
      },
      { file: "dynamic.ts", disposition: "scanned" }
    ],
    observations: [
      {
        file: "observed.ts",
        anchor: "observed-anchor",
        line: 2,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: "supporting"
      },
      {
        file: "demoted.ts",
        anchor: "demoted-anchor",
        line: 2,
        provider: "stripe",
        identifier: "balance.retrieve",
        evidenceKind: "sdk-call",
        confidence: "demoted"
      }
    ]
  };
}

async function withSources<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "coverage-compare-"));
  try {
    for (const [name, content] of Object.entries(SOURCES)) {
      await writeFile(join(dir, name), content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCompare(
  manifestInput: unknown,
  reportInput: unknown,
  dir: string
): Promise<ComparisonReport> {
  const manifestResult = validateManifest(manifestInput);
  assert.ok(
    manifestResult.ok,
    manifestResult.ok ? "" : manifestResult.errors.join("; ")
  );
  const reportResult = validateReport(reportInput);
  assert.ok(reportResult.ok, reportResult.ok ? "" : reportResult.errors.join("; "));
  assert.equal(reportResult.report.reportVersion, 1);
  if (reportResult.report.reportVersion !== 1) assert.fail("expected a v1 report");
  const comparison = await compareReports(
    manifestResult.manifest,
    reportResult.report,
    dir
  );
  assert.equal(comparison.ok, true, comparison.ok ? "" : comparison.errors.join("; "));
  return comparison.report;
}

function scenarioOf(report: ComparisonReport, id: string) {
  const scenario = report.scenarios.find((entry) => entry.scenarioId === id);
  assert.ok(scenario, `scenario ${id} not found`);
  return scenario;
}

test("a matching report compares clean", async () => {
  await withSources(async (dir) => {
    const report = await runCompare(baseManifest(), baseReport(), dir);
    assert.equal(report.ok, true);
    assert.equal(report.totals.matched, 4);
    assert.equal(report.totals.unresolved, 1);
    assert.equal(report.totals.unexpectedObservations, 0);
    assert.equal(
      scenarioOf(report, "dynamic-scenario").results[0]!.status,
      "unresolved"
    );
  });
});

test("missing observation is reported", async () => {
  await withSources(async (dir) => {
    const mutated = {
      ...baseReport(),
      observations: [] as ScanReportV1["observations"]
    };
    // keep demoted observation removed too so only observed missing matters
    const report = await runCompare(baseManifest(), mutated, dir);
    assert.equal(report.ok, false);
    assert.equal(scenarioOf(report, "observed-scenario").results[0]!.status, "missing");
  });
});

test("unexpected observation at a known anchor is reported", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations.push({
      file: "observed.ts",
      anchor: "observed-anchor",
      line: 2,
      provider: "github",
      identifier: "repos.createRelease",
      evidenceKind: "sdk-call",
      confidence: "alertable"
    });
    const report = await runCompare(baseManifest(), mutated, dir);
    assert.equal(report.ok, false);
    assert.equal(report.totals.unexpectedObservations, 1);
    assert.match(
      report.unexpectedObservations[0]!.detail,
      /no expectation in observed-scenario covers/
    );
  });
});

test("unexpected observation at an unknown anchor is reported", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations.push({
      file: "stray.ts",
      anchor: "stray-anchor",
      line: 1,
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: "alertable"
    });
    const report = await runCompare(baseManifest(), mutated, dir);
    assert.equal(report.ok, false);
    assert.equal(report.unexpectedObservations[0]!.scenarioId, null);
    assert.match(
      report.unexpectedObservations[0]!.detail,
      /matches no oracle scenario/
    );
  });
});

test("wrong provider is a provider mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations[0]!.provider = "openai";
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("provider"));
  });
});

test("wrong identifier is an identifier mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations[0]!.identifier = "repos.createRelease";
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("identifier"));
  });
});

test("wrong evidence kind is an evidence-kind mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations[0]!.evidenceKind = "http-request";
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("evidence-kind"));
  });
});

test("wrong location is a location mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations[0]!.line = 99;
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("location"));
  });
});

test("wrong confidence is a confidence mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations[0]!.confidence = "alertable";
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("confidence"));
  });
});

test("wrong disposition is a disposition mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.files = mutated.files.map((file) =>
      file.file === "observed.ts"
        ? { ...file, disposition: "excluded", reason: "generated source path" }
        : file
    ) as ScanReportV1["files"];
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "observed-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("disposition"));
  });
});

test("excluded file with wrong reason is a disposition mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.files = mutated.files.map((file) =>
      file.file === "generated.ts" ? { ...file, reason: "vendored source path" } : file
    ) as ScanReportV1["files"];
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "generated-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("disposition"));
  });
});

test("excluded file with an observation is unexpected", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations.push({
      file: "generated.ts",
      anchor: "generated-anchor",
      line: 2,
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: "alertable"
    });
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "generated-scenario").results[0]!;
    assert.equal(result.status, "unexpected");
  });
});

test("no-observation violated by an observation is unexpected", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations.push({
      file: "quiet.ts",
      anchor: "quiet-anchor",
      line: 2,
      provider: "openai",
      identifier: "responses.create",
      evidenceKind: "sdk-call",
      confidence: "alertable"
    });
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "quiet-scenario").results[0]!;
    assert.equal(result.status, "unexpected");
  });
});

test("empty cannot satisfy demoted", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations = mutated.observations.filter(
      (observation) => observation.file !== "demoted.ts"
    );
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "demoted-scenario").results[0]!;
    assert.equal(result.status, "missing");
  });
});

test("demoted with alertable confidence is a confidence mismatch", async () => {
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    for (const observation of mutated.observations) {
      if (observation.file === "demoted.ts") {
        observation.confidence = "alertable";
      }
    }
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "demoted-scenario").results[0]!;
    assert.equal(result.status, "mismatched");
    assert.ok(result.dimensions.includes("confidence"));
  });
});

test("uncertain never satisfies and does not fail the comparison", async () => {
  await withSources(async (dir) => {
    const report = await runCompare(baseManifest(), baseReport(), dir);
    const result = scenarioOf(report, "dynamic-scenario").results[0]!;
    assert.equal(result.status, "unresolved");
    assert.equal(report.ok, true);
  });
  await withSources(async (dir) => {
    const mutated = structuredClone(baseReport());
    mutated.observations.push({
      file: "dynamic.ts",
      anchor: "dynamic-anchor",
      line: 2,
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: "alertable"
    });
    const report = await runCompare(baseManifest(), mutated, dir);
    const result = scenarioOf(report, "dynamic-scenario").results[0]!;
    assert.equal(result.status, "unresolved");
    assert.match(result.detail, /require human review/);
    assert.equal(report.ok, true);
  });
});

test("mismatched revisions are reported as errors", async () => {
  await withSources(async (dir) => {
    const manifest = validateManifest(baseManifest());
    assert.ok(manifest.ok);
    const reportInput = {
      ...baseReport(),
      releaseRelayRevision: "ffffffffffffffffffffffffffffffffffffffff"
    };
    const reportResult = validateReport(reportInput);
    assert.ok(reportResult.ok);
    assert.equal(reportResult.report.reportVersion, 1);
    if (reportResult.report.reportVersion !== 1) assert.fail("expected a v1 report");
    const comparison = await compareReports(
      manifest.manifest,
      reportResult.report,
      dir
    );
    assert.equal(comparison.ok, false);
    assert.match(comparison.errors[0]! ?? "", /does not match manifest.revision/);
  });
});

test("unresolvable anchors are reported as errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-compare-missing-"));
  try {
    const manifest = baseManifest();
    manifest.scenarios[0]!.source = { file: "missing.ts", anchor: "absent-anchor" };
    const report = baseReport();
    const manifestResult = validateManifest(manifest);
    assert.ok(manifestResult.ok);
    const reportResult = validateReport(report);
    assert.ok(reportResult.ok);
    assert.equal(reportResult.report.reportVersion, 1);
    if (reportResult.report.reportVersion !== 1) assert.fail("expected a v1 report");
    const comparison = await compareReports(
      manifestResult.manifest,
      reportResult.report,
      dir
    );
    assert.equal(comparison.ok, false);
    assert.match(comparison.errors[0]! ?? "", /could not be read|was not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("human-readable and JSON reports are stable and source-free", async () => {
  await withSources(async (dir) => {
    const report = await runCompare(baseManifest(), baseReport(), dir);
    const first = JSON.stringify(report, null, 2);
    const second = JSON.stringify(report, null, 2);
    assert.equal(first, second);
    assert.ok(
      !first.includes("export const"),
      "report must not include repository source"
    );
  });
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

test("the compare CLI reports mismatches and supports --json", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "coverage-compare-cli-source-"));
  const toolDir = await mkdtemp(join(tmpdir(), "coverage-compare-cli-tool-"));
  try {
    for (const [name, content] of Object.entries(SOURCES)) {
      await writeFile(join(sourceDir, name), content);
    }
    git(sourceDir, ["init"]);
    git(sourceDir, ["config", "user.email", "test@test.com"]);
    git(sourceDir, ["config", "user.name", "test"]);
    git(sourceDir, ["add", "."]);
    git(sourceDir, ["commit", "-m", "source"]);
    const revision = git(sourceDir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifestPath = join(toolDir, "manifest.json");
    const reportPath = join(toolDir, "report.json");
    await writeFile(manifestPath, JSON.stringify({ ...baseManifest(), revision }));
    await writeFile(
      reportPath,
      JSON.stringify({ ...baseReport(), releaseRelayRevision: revision })
    );
    const cliArgs = ["compare", manifestPath, reportPath, "--source-root", sourceDir];
    const ok = runCli(cliArgs, toolDir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /scenarios=/);

    const jsonOk = runCli([...cliArgs, "--json"], toolDir);
    assert.equal(jsonOk.status, 0, jsonOk.stderr);
    const parsed = JSON.parse(jsonOk.stdout) as ComparisonReport;
    assert.equal(parsed.ok, true);
    assert.ok(!jsonOk.stdout.includes("export const"));

    const badReport = {
      ...baseReport(),
      releaseRelayRevision: revision,
      observations: [] as ScanReportV1["observations"]
    };
    await writeFile(reportPath, JSON.stringify(badReport));
    const mismatch = runCli(cliArgs, toolDir);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stdout, /missing/);
    const mismatchJson = runCli([...cliArgs, "--json"], toolDir);
    assert.equal(mismatchJson.status, 1);
    const parsedMismatch = JSON.parse(mismatchJson.stdout) as ComparisonReport;
    assert.equal(parsedMismatch.ok, false);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(toolDir, { recursive: true, force: true });
  }
});

test("the compare CLI rejects a source path that escapes through a symlink", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "coverage-compare-cli-source-"));
  const toolDir = await mkdtemp(join(tmpdir(), "coverage-compare-cli-tool-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "coverage-compare-outside-"));
  try {
    git(sourceDir, ["init"]);
    git(sourceDir, ["config", "user.email", "test@test.com"]);
    git(sourceDir, ["config", "user.name", "test"]);
    const outsideFile = join(outsideDir, "outside.ts");
    await writeFile(outsideFile, "export const escapedAnchor = 1;\n");
    await symlink(outsideFile, join(sourceDir, "linked.ts"));
    git(sourceDir, ["add", "linked.ts"]);
    git(sourceDir, ["commit", "-m", "link"]);
    const revision = git(sourceDir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest: OracleManifest = {
      version: 1,
      revision,
      scenarios: [
        baseScenario("symlink-scenario", "linked.ts", "escapedAnchor", [
          {
            outcome: "no-observation",
            provider: "github",
            identifier: "repos.list",
            confidence: "none"
          }
        ])
      ]
    };
    const report: ScanReportV1 = {
      reportVersion: 1,
      manifestVersion: 1,
      releaseRelayRevision: revision,
      breakscopeRevision: BREAKSCOPE_REVISION,
      ruleset: RULESET,
      files: [{ file: "linked.ts", disposition: "scanned" }],
      observations: []
    };
    const manifestPath = join(toolDir, "manifest.json");
    const reportPath = join(toolDir, "report.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(reportPath, JSON.stringify(report));
    const result = runCli(
      ["compare", manifestPath, reportPath, "--source-root", sourceDir],
      toolDir
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /linked\.ts is outside source root/);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(toolDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("the compare CLI rejects v2 reports until the v2 comparator ships", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-compare-v2-cli-"));
  try {
    const manifestPath = join(dir, "manifest.json");
    const reportPath = join(repoRoot, "scenarios/report-v2.example.json");
    await writeFile(manifestPath, JSON.stringify(baseManifest()));
    const result = runCli(
      ["compare", manifestPath, reportPath, "--source-root", repoRoot],
      dir
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not yet support reportVersion 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
