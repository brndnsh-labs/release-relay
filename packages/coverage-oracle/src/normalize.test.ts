import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSnapshot } from "./normalize.js";
import type { OracleManifest } from "./schema.js";
import type { BreakscopeSnapshot } from "./snapshot.js";
import { validateReport } from "./report.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function git(cwd: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "" };
}

function makeManifest(
  revision: string,
  scenarios: OracleManifest["scenarios"]
): OracleManifest {
  return { version: 1, revision, scenarios };
}

function baseSnapshot(revision: string, breakscopeRev: string): BreakscopeSnapshot {
  return {
    snapshotVersion: 1,
    repository: "brndnsh-labs/release-relay",
    repositoryId: 1338698763,
    releaseRelayRevision: revision,
    breakscopeRevision: breakscopeRev,
    ruleset: "typescript-deterministic-v5",
    scan: {
      id: "scan-1",
      status: "completed",
      completedAt: "2026-08-19T12:00:00.000Z"
    },
    files: [],
    observations: []
  };
}

const BREAKSCOPE_REV = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("normalize succeeds for a minimal isolated repo (byte-stable)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-ok-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    await writeFile(join(dir, "other.ts"), "export const otherAnchor = 2;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();

    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      },
      {
        id: "s2",
        purpose: "test2",
        source: { file: "other.ts", anchor: "otherAnchor" },
        expectations: [
          {
            outcome: "no-observation",
            provider: "github",
            identifier: "repos.list",
            confidence: "none"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);

    // Resolve anchor lines to build snapshot observations
    // myAnchor at line 1
    const snapshot = baseSnapshot(head, BREAKSCOPE_REV);
    snapshot.files = [
      { file: "sample.ts", disposition: "scanned" },
      { file: "other.ts", disposition: "scanned" }
    ];
    snapshot.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];

    const r1 = await normalizeSnapshot(manifest, snapshot, BREAKSCOPE_REV, dir);
    assert.equal(r1.ok, true, r1.ok ? "" : r1.errors.join("; "));
    if (r1.ok) {
      assert.equal(r1.report.releaseRelayRevision, head);
      assert.equal(r1.report.breakscopeRevision, BREAKSCOPE_REV);
      assert.equal(r1.report.observations.length, 1);
      assert.equal(r1.report.observations[0]?.confidence, "alertable");
      assert.equal(r1.report.observations[0]?.line, 1);
      assert.ok(validateReport(r1.report).ok);
      const json1 = JSON.stringify(r1.report, null, 2);
      const r2 = await normalizeSnapshot(manifest, snapshot, BREAKSCOPE_REV, dir);
      assert.equal(r2.ok, true);
      if (r2.ok) assert.equal(JSON.stringify(r2.report, null, 2), json1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize rejects extra fields in snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-extra-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snapshot = baseSnapshot(head, BREAKSCOPE_REV) as unknown as Record<
      string,
      unknown
    >;
    snapshot["extra"] = true;
    (snapshot as unknown as BreakscopeSnapshot).files = [
      { file: "sample.ts", disposition: "scanned" }
    ];
    (snapshot as unknown as BreakscopeSnapshot).observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    const r = await normalizeSnapshot(manifest, snapshot, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("unknown field extra")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize rejects wrong repository and wrong breakscope revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-wrong-repo-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const base = baseSnapshot(head, BREAKSCOPE_REV);
    base.files = [{ file: "sample.ts", disposition: "scanned" }];
    base.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];

    const wrongRepo = { ...base, repository: "other/repo" };
    let r = await normalizeSnapshot(manifest, wrongRepo, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("repository must be")));

    const wrongFlag = await normalizeSnapshot(
      manifest,
      base,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      dir
    );
    assert.equal(wrongFlag.ok, false);
    if (!wrongFlag.ok)
      assert.ok(
        wrongFlag.errors.some((e) =>
          e.includes("does not match snapshot.breakscopeRevision")
        )
      );

    const wrongSnapshotRev = {
      ...base,
      breakscopeRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    };
    r = await normalizeSnapshot(
      manifest,
      wrongSnapshotRev,
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      dir
    );
    // snapshot validation will catch? but flag matches snapshot, so it passes snapshot validation, but we still check flag==snapshot; this one should pass flag check but snapshot's breakscopeRevision is still valid sha, so it would be considered valid — we need wrong ruleset instead
    const wrongRuleset = { ...base, ruleset: "unknown-ruleset" };
    r = await normalizeSnapshot(manifest, wrongRuleset, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("ruleset must be")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize fails on incomplete scan and missing disposition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-scan-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const base = baseSnapshot(head, BREAKSCOPE_REV);
    base.files = [{ file: "sample.ts", disposition: "scanned" }];
    base.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    const incomplete = {
      ...base,
      scan: {
        id: "scan-1",
        status: "pending" as const,
        completedAt: "2026-08-19T12:00:00.000Z"
      }
    };
    let r = await normalizeSnapshot(manifest, incomplete, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("status must be")));

    const missingDisp = baseSnapshot(head, BREAKSCOPE_REV);
    missingDisp.files = []; // missing disposition for sample.ts
    missingDisp.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    r = await normalizeSnapshot(manifest, missingDisp, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("missing disposition")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize reports missing/duplicate anchor and unmatched line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-anchor-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifestOk = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);

    // missing anchor at revision
    const manifestMissing = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "absentAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snap = baseSnapshot(head, BREAKSCOPE_REV);
    snap.files = [{ file: "sample.ts", disposition: "scanned" }];
    snap.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    let r = await normalizeSnapshot(manifestMissing, snap, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.ok(
        r.errors.some((e) => e.includes("anchor") && e.includes("was not found"))
      );

    // duplicate anchor: create file with duplicate
    await writeFile(
      join(dir, "dup.ts"),
      "export const dup = 1;\nexport const dup = 2;\n"
    );
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "dup"]);
    const head2 = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifestDup = makeManifest(head2, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "dup.ts", anchor: "dup" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snapDup = baseSnapshot(head2, BREAKSCOPE_REV);
    snapDup.files = [{ file: "dup.ts", disposition: "scanned" }];
    snapDup.observations = [
      {
        file: "dup.ts",
        lineStart: 1,
        lineEnd: 2,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    r = await normalizeSnapshot(manifestDup, snapDup, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("appears")));

    // unmatched line: observation covers line 10 but anchor at line 1
    const manifestUnmatched = manifestOk; // head still, but we are at head2 now, so need to use head (old) manifest with new dir head2? Let's use head2 manifest with sample.ts
    const manifestForUnmatched = makeManifest(head2, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snapUnmatched = baseSnapshot(head2, BREAKSCOPE_REV);
    snapUnmatched.files = [{ file: "sample.ts", disposition: "scanned" }];
    snapUnmatched.observations = [
      {
        file: "sample.ts",
        lineStart: 10,
        lineEnd: 12,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    r = await normalizeSnapshot(
      manifestForUnmatched,
      snapUnmatched,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.ok(
        r.errors.some(
          (e) =>
            e.includes("does not cover any manifest anchor") ||
            e.includes("missing observation")
        )
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize fails on unexpected observation for no-observation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-unexpected-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "sample.ts", anchor: "myAnchor" },
        expectations: [
          {
            outcome: "no-observation",
            provider: "github",
            identifier: "repos.list",
            confidence: "none"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snap = baseSnapshot(head, BREAKSCOPE_REV);
    snap.files = [{ file: "sample.ts", disposition: "scanned" }];
    snap.observations = [
      {
        file: "sample.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    const r = await normalizeSnapshot(manifest, snap, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, false);
    if (!r.ok)
      assert.ok(
        r.errors.some(
          (e) => e.includes("unexpected observation") || e.includes("no observation")
        )
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("confidence boundaries map correctly and nondeterministic ordering is stable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-conf-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "a.ts"), "export const aAnchor = 1;\n");
    await writeFile(join(dir, "b.ts"), "export const bAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "a.ts", anchor: "aAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      },
      {
        id: "s2",
        purpose: "test",
        source: { file: "b.ts", anchor: "bAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "supporting"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const snap = baseSnapshot(head, BREAKSCOPE_REV);
    // Deliberately unordered input to test determinism
    snap.files = [
      { file: "b.ts", disposition: "scanned" },
      { file: "a.ts", disposition: "scanned" }
    ];
    snap.observations = [
      {
        file: "b.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.6
      },
      {
        file: "a.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    const r = await normalizeSnapshot(manifest, snap, BREAKSCOPE_REV, dir);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.report.files[0]?.file, "a.ts");
      assert.equal(r.report.observations[0]?.file, "a.ts");
      assert.equal(r.report.observations[0]?.confidence, "alertable");
      assert.equal(r.report.observations[1]?.confidence, "supporting");
      // Swap input order and ensure output identical
      const snap2 = {
        ...snap,
        files: [...snap.files].reverse(),
        observations: [...snap.observations].reverse()
      };
      const r2 = await normalizeSnapshot(manifest, snap2, BREAKSCOPE_REV, dir);
      assert.equal(r2.ok, true);
      if (r2.ok) assert.deepEqual(r2.report, r.report);
    }

    // demoted boundary
    const snapDemoted = baseSnapshot(head, BREAKSCOPE_REV);
    snapDemoted.files = [
      { file: "a.ts", disposition: "scanned" },
      { file: "b.ts", disposition: "scanned" }
    ];
    snapDemoted.observations = [
      {
        file: "a.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.3
      },
      {
        file: "b.ts",
        lineStart: 1,
        lineEnd: 1,
        provider: "github",
        identifier: "repos.list",
        evidenceKind: "sdk-call",
        confidence: 0.95
      }
    ];
    const manifestDemoted = makeManifest(head, [
      {
        id: "s1",
        purpose: "test",
        source: { file: "a.ts", anchor: "aAnchor" },
        expectations: [
          {
            outcome: "demoted",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "demoted"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      },
      {
        id: "s2",
        purpose: "test",
        source: { file: "b.ts", anchor: "bAnchor" },
        expectations: [
          {
            outcome: "observation",
            provider: "github",
            identifier: "repos.list",
            evidenceKind: "sdk-call",
            confidence: "alertable"
          }
        ],
        rationale: "test",
        reviewedBy: "maintainer",
        reviewedAt: "2026-08-19"
      }
    ]);
    const r3 = await normalizeSnapshot(
      manifestDemoted,
      snapDemoted,
      BREAKSCOPE_REV,
      dir
    );
    assert.equal(r3.ok, true);
    if (r3.ok)
      assert.equal(
        r3.report.observations.find((o) => o.file === "a.ts")?.confidence,
        "demoted"
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI normalize succeeds and is byte-stable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normalize-cli-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const manifest: OracleManifest = {
      version: 1,
      revision: head,
      scenarios: [
        {
          id: "cli",
          purpose: "cli",
          source: { file: "sample.ts", anchor: "myAnchor" },
          expectations: [
            {
              outcome: "observation",
              provider: "github",
              identifier: "repos.list",
              evidenceKind: "sdk-call",
              confidence: "alertable"
            }
          ],
          rationale: "test",
          reviewedBy: "maintainer",
          reviewedAt: "2026-08-19"
        }
      ]
    };
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const snapshot: BreakscopeSnapshot = {
      snapshotVersion: 1,
      repository: "brndnsh-labs/release-relay",
      repositoryId: 1338698763,
      releaseRelayRevision: head,
      breakscopeRevision: BREAKSCOPE_REV,
      ruleset: "typescript-deterministic-v5",
      scan: {
        id: "scan-1",
        status: "completed",
        completedAt: "2026-08-19T12:00:00.000Z"
      },
      files: [{ file: "sample.ts", disposition: "scanned" }],
      observations: [
        {
          file: "sample.ts",
          lineStart: 1,
          lineEnd: 1,
          provider: "github",
          identifier: "repos.list",
          evidenceKind: "sdk-call",
          confidence: 0.95
        }
      ]
    };
    const snapshotPath = join(dir, "snapshot.json");
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
    const cli = join(repoRoot, "packages/coverage-oracle/dist/cli.js");
    const outPath = join(dir, "out.json");
    let r = spawnSync(
      process.execPath,
      [
        cli,
        "normalize",
        manifestPath,
        snapshotPath,
        "--breakscope-revision",
        BREAKSCOPE_REV,
        "--output",
        outPath
      ],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    const out1 = await (await import("node:fs/promises")).readFile(outPath, "utf8");
    r = spawnSync(
      process.execPath,
      [
        cli,
        "normalize",
        manifestPath,
        snapshotPath,
        "--breakscope-revision",
        BREAKSCOPE_REV
      ],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, out1);
    const parsed = JSON.parse(out1);
    assert.ok(validateReport(parsed).ok);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
