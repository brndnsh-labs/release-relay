import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSnapshot } from "./normalize.js";
import { validateReport } from "./report.js";
import type { OracleManifest } from "./schema.js";
import type { BreakscopeSnapshot } from "./snapshot.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const BREAKSCOPE_REV = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function manifest(revision: string): OracleManifest {
  return {
    version: 1,
    revision,
    scenarios: [
      {
        id: "oracle-only",
        purpose: "A deliberately unrelated reviewed expectation.",
        source: { file: "a.ts", anchor: "unseenAnchor" },
        expectations: [
          {
            outcome: "no-observation",
            provider: "github",
            identifier: "repos.list",
            confidence: "none"
          }
        ],
        rationale: "Proves normalization does not derive output from oracle truth.",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
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
      id: "scan-1",
      status: "completed",
      completedAt: "2026-08-19T12:00:00.000Z"
    },
    files: [
      { file: "z.ts", disposition: "scanned" },
      { file: "a.ts", disposition: "scanned" }
    ],
    observations: [
      {
        file: "z.ts",
        lineStart: 12,
        lineEnd: 18,
        provider: "openai",
        identifier: "responses.create",
        evidenceKind: "sdk-call",
        confidence: 0.95
      },
      {
        file: "a.ts",
        lineStart: 4,
        lineEnd: 4,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.5
      },
      {
        file: "a.ts",
        lineStart: 21,
        lineEnd: 24,
        provider: "github",
        identifier: "repos.createRelease",
        evidenceKind: "sdk-call",
        confidence: 0.2
      }
    ]
  };
}

async function withRepo<T>(
  fn: (dir: string, revision: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "normalize-v2-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "README.md"), "v2 normalization fixture\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    return await fn(dir, git(dir, ["rev-parse", "HEAD"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("normalization preserves every validated observation without oracle matching", async () => {
  await withRepo(async (dir, revision) => {
    const input = snapshot(revision);
    const result = await normalizeSnapshot(
      manifest(revision),
      input,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, true, result.ok ? "" : result.errors.join("; "));
    if (!result.ok) return;

    assert.equal(result.report.reportVersion, 2);
    assert.deepEqual(
      result.report.files.map((file) => file.file),
      ["a.ts", "z.ts"]
    );
    assert.deepEqual(result.report.observations, [
      {
        file: "a.ts",
        lineStart: 4,
        lineEnd: 4,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: "supporting"
      },
      {
        file: "a.ts",
        lineStart: 21,
        lineEnd: 24,
        provider: "github",
        identifier: "repos.createRelease",
        evidenceKind: "sdk-call",
        confidence: "demoted"
      },
      {
        file: "z.ts",
        lineStart: 12,
        lineEnd: 18,
        provider: "openai",
        identifier: "responses.create",
        evidenceKind: "sdk-call",
        confidence: "alertable"
      }
    ]);
    assert.ok(validateReport(result.report).ok);

    const reordered = {
      ...input,
      files: [...input.files].reverse(),
      observations: [...input.observations].reverse()
    };
    const again = await normalizeSnapshot(
      manifest(revision),
      reordered,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(again.ok, true, again.ok ? "" : again.errors.join("; "));
    if (again.ok) assert.deepEqual(again.report, result.report);
  });
});

test("normalization keeps identity, revision, completion, bounds, and fields fail closed", async () => {
  await withRepo(async (dir, revision) => {
    const input = snapshot(revision);
    let result = await normalizeSnapshot(
      manifest(revision),
      input,
      "b".repeat(40),
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) => error.includes("does not match snapshot"))
      );

    result = await normalizeSnapshot(
      { ...manifest(revision), revision: "c".repeat(40) },
      input,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) => error.includes("does not match manifest"))
      );

    const incomplete = structuredClone(input) as unknown as Record<string, unknown>;
    incomplete.scan = { ...input.scan, status: "running" };
    result = await normalizeSnapshot(
      manifest(revision),
      incomplete,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) => error.includes("status must be one of completed"))
      );

    const missingDisposition = structuredClone(input) as BreakscopeSnapshot;
    missingDisposition.files = missingDisposition.files.filter(
      (file) => file.file !== "a.ts"
    );
    result = await normalizeSnapshot(
      manifest(revision),
      missingDisposition,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) =>
          error.includes("missing disposition for manifest file a.ts")
        )
      );

    const observationWithoutDisposition = structuredClone(input) as BreakscopeSnapshot;
    observationWithoutDisposition.observations.push({
      file: "ghost.ts",
      lineStart: 1,
      lineEnd: 1,
      provider: "github",
      identifier: "repos.list",
      evidenceKind: "sdk-call",
      confidence: 0.95
    });
    result = await normalizeSnapshot(
      manifest(revision),
      observationWithoutDisposition,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) =>
          error.includes("ghost.ts, which has no file disposition")
        )
      );

    const outOfBounds = structuredClone(input) as unknown as BreakscopeSnapshot;
    const firstObservation = outOfBounds.observations[0];
    assert.ok(firstObservation);
    firstObservation.lineStart = 19;
    result = await normalizeSnapshot(
      manifest(revision),
      outOfBounds,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) => error.includes("lineStart must be <= lineEnd"))
      );

    const extra = structuredClone(input) as unknown as Record<string, unknown>;
    extra.unreviewed = true;
    result = await normalizeSnapshot(manifest(revision), extra, BREAKSCOPE_REV, dir);
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.ok(
        result.errors.some((error) => error.includes("unknown field unreviewed"))
      );
  });
});

test("CLI normalization emits a byte-stable v2 report", async () => {
  await withRepo(async (dir, revision) => {
    const toolDir = await mkdtemp(join(tmpdir(), "normalize-v2-tool-"));
    try {
      const manifestPath = join(toolDir, "manifest.json");
      const snapshotPath = join(toolDir, "snapshot.json");
      await writeFile(manifestPath, JSON.stringify(manifest(revision), null, 2));
      await writeFile(snapshotPath, JSON.stringify(snapshot(revision), null, 2));
      const cli = join(repoRoot, "packages/coverage-oracle/dist/cli.js");
      const args = [
        cli,
        "normalize",
        manifestPath,
        snapshotPath,
        "--breakscope-revision",
        BREAKSCOPE_REV,
        "--source-root",
        dir
      ];
      const first = spawnSync(process.execPath, args, {
        cwd: toolDir,
        encoding: "utf8"
      });
      assert.equal(first.status, 0, first.stderr);
      const second = spawnSync(process.execPath, args, {
        cwd: toolDir,
        encoding: "utf8"
      });
      assert.equal(second.status, 0, second.stderr);
      assert.equal(second.stdout, first.stdout);
      assert.equal(JSON.parse(first.stdout).reportVersion, 2);
    } finally {
      await rm(toolDir, { recursive: true, force: true });
    }
  });
});
