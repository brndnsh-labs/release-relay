import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type ComparisonReport, compareReports } from "./compare.js";
import { normalizeSnapshot } from "./normalize.js";
import { type OracleManifest, type Provider } from "./schema.js";
import type { BreakscopeSnapshot } from "./snapshot.js";

const BREAKSCOPE_REV = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const SOURCES: Record<string, string> = {
  "a.ts": [
    "export const first = 1;",
    "// read-anchor",
    "export const readCall = 2;",
    "// second-call-anchor",
    "export const secondCall = 3;"
  ].join("\n"),
  "b.ts": ["// missing-anchor", "export const ghostCall = 4;"].join("\n"),
  "c.ts": ["// mismatch-anchor", "export const portalCall = 5;"].join("\n"),
  "d.ts": ["// demoted-anchor", "export const legacyCall = 6;"].join("\n"),
  "e.ts": ["// uncertain-anchor", "export const mysteryCall = 7;"].join("\n"),
  "generated.ts": "// generated-placeholder\n"
};

function scenario(
  id: string,
  file: string,
  anchor: string,
  expectations: OracleManifest["scenarios"][number]["expectations"]
): OracleManifest["scenarios"][number] {
  return {
    id,
    purpose: `Pipeline fixture scenario ${id}.`,
    source: { file, anchor },
    expectations,
    rationale: "Reviewed fixture rationale written from source intent.",
    reviewedBy: "maintainer",
    reviewedAt: "2026-08-21"
  };
}

function located(
  id: string,
  file: string,
  anchor: string,
  provider: Provider,
  identifier: string,
  confidence: "alertable" | "supporting"
): OracleManifest["scenarios"][number]["expectations"][number] {
  return {
    outcome: "observation",
    id,
    provider,
    identifier,
    evidenceKind: "sdk-call",
    confidence,
    locationAnchor: { file, anchor }
  };
}

function manifest(revision: string): OracleManifest {
  return {
    version: 2,
    revision,
    scenarios: [
      scenario("multi-call", "a.ts", "read-anchor", [
        located(
          "multi-call.repos.list",
          "a.ts",
          "export const readCall",
          "github",
          "repos.list",
          "alertable"
        ),
        located(
          "multi-call.repos.createRelease",
          "a.ts",
          "export const secondCall",
          "github",
          "repos.createRelease",
          "alertable"
        )
      ]),
      scenario("absent-call", "b.ts", "missing-anchor", [
        located(
          "absent-call.responses.create",
          "b.ts",
          "export const ghostCall",
          "openai",
          "responses.create",
          "supporting"
        )
      ]),
      scenario("wrong-band", "c.ts", "mismatch-anchor", [
        located(
          "wrong-band.checkout.sessions.create",
          "c.ts",
          "export const portalCall",
          "stripe",
          "checkout.sessions.create",
          "alertable"
        )
      ]),
      scenario("legacy-band", "d.ts", "demoted-anchor", [
        {
          outcome: "demoted",
          id: "legacy-band.billingPortal.sessions.create",
          provider: "stripe",
          identifier: "billingPortal.sessions.create",
          evidenceKind: "sdk-call",
          confidence: "demoted",
          locationAnchor: { file: "d.ts", anchor: "export const legacyCall" }
        }
      ]),
      scenario("skip-generated", "generated.ts", "generated-placeholder", [
        { outcome: "excluded", confidence: "none", reason: "generated source path" }
      ]),
      scenario("needs-human-review", "e.ts", "uncertain-anchor", [
        { outcome: "uncertain", confidence: "none" }
      ])
    ]
  };
}

function snapshot(revision: string): BreakscopeSnapshot {
  return {
    snapshotVersion: 1,
    repository: "brndnsh-labs/release-relay",
    repositoryId: 1338698763,
    releaseRelayRevision: revision,
    breakscopeRevision: BREAKSCOPE_REV,
    ruleset: "typescript-deterministic-v5",
    scan: {
      id: "scan-pipeline-1",
      status: "completed",
      completedAt: "2026-08-21T12:00:00.000Z"
    },
    files: [
      { file: "a.ts", disposition: "scanned" },
      { file: "b.ts", disposition: "scanned" },
      { file: "c.ts", disposition: "scanned" },
      { file: "d.ts", disposition: "scanned" },
      { file: "e.ts", disposition: "scanned" },
      { file: "generated.ts", disposition: "excluded", reason: "generated source path" }
    ],
    observations: [
      {
        file: "a.ts",
        lineStart: 3,
        lineEnd: 3,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.96
      },
      {
        file: "a.ts",
        lineStart: 5,
        lineEnd: 5,
        provider: "github",
        identifier: "repos.createRelease",
        evidenceKind: "sdk-call",
        confidence: 0.95
      },
      {
        file: "a.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "openai",
        identifier: "embeddings.create",
        evidenceKind: "sdk-call",
        confidence: 0.95
      },
      {
        file: "c.ts",
        lineStart: 2,
        lineEnd: 2,
        provider: "stripe",
        identifier: "checkout.sessions.create",
        evidenceKind: "sdk-call",
        confidence: 0.73
      },
      {
        file: "d.ts",
        lineStart: 2,
        lineEnd: 3,
        provider: "stripe",
        identifier: "billingPortal.sessions.create",
        evidenceKind: "sdk-call",
        confidence: 0.2
      },
      {
        file: "e.ts",
        lineStart: 1,
        lineEnd: 2,
        provider: "anthropic",
        identifier: "messages.create",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ]
  };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function resultOf(report: ComparisonReport, expectationId: string) {
  for (const scenario of report.scenarios) {
    const found = scenario.results.find(
      (entry) => entry.expectationId === expectationId
    );
    if (found !== undefined) return found;
  }
  assert.fail(`no result for ${expectationId}`);
}

test("normalize then compare exercises every outcome status on the reviewed fixture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-pipeline-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    for (const [name, content] of Object.entries(SOURCES)) {
      await writeFile(join(dir, name), `${content}\n`);
    }
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "fixture"]);
    const revision = git(dir, ["rev-parse", "HEAD"]);

    const normalized = await normalizeSnapshot(
      manifest(revision),
      snapshot(revision),
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(
      normalized.ok,
      true,
      normalized.ok ? "" : normalized.errors.join("; ")
    );
    if (!normalized.ok) return;
    assert.equal(normalized.report.reportVersion, 2);
    assert.equal(normalized.report.manifestVersion, 2);

    const comparison = await compareReports(manifest(revision), normalized.report, dir);
    assert.equal(
      comparison.ok,
      true,
      comparison.ok ? "" : comparison.errors.join("; ")
    );
    if (!comparison.ok) return;

    const report = comparison.report;
    assert.equal(report.ok, false);

    assert.equal(resultOf(report, "multi-call.repos.list").status, "matched");
    assert.match(resultOf(report, "multi-call.repos.list").detail, /a\.ts:3-3/);
    assert.equal(resultOf(report, "multi-call.repos.createRelease").status, "matched");
    assert.match(
      resultOf(report, "multi-call.repos.createRelease").detail,
      /a\.ts:5-5/
    );

    assert.equal(resultOf(report, "absent-call.responses.create").status, "missing");

    const banded = resultOf(report, "wrong-band.checkout.sessions.create");
    assert.equal(banded.status, "mismatched");
    assert.deepEqual(banded.dimensions, ["confidence"]);

    assert.equal(
      resultOf(report, "legacy-band.billingPortal.sessions.create").status,
      "matched"
    );

    const excludedResult = report.scenarios.find(
      (entry) => entry.scenarioId === "skip-generated"
    )!.results[0]!;
    assert.equal(excludedResult.status, "matched");
    assert.match(excludedResult.detail, /excluded as expected/);

    const uncertainResult = report.scenarios.find(
      (entry) => entry.scenarioId === "needs-human-review"
    )!.results[0]!;
    assert.equal(uncertainResult.status, "unresolved");

    assert.equal(report.totals.unexpectedObservations, 1);
    assert.equal(report.unexpectedObservations[0]!.file, "a.ts");
    assert.equal(report.unexpectedObservations[0]!.identifier, "embeddings.create");
    assert.match(
      report.unexpectedObservations[0]!.detail,
      /claimed by no oracle expectation/
    );

    assert.equal(report.totals.matched, 4);
    assert.equal(report.totals.missing, 1);
    assert.equal(report.totals.mismatched, 1);
    assert.equal(report.totals.unresolved, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
