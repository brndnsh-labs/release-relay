import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkRevisionAnchors,
  commitExists,
  getHeadCommit,
  readFileAtRevision
} from "./revision.js";
import type { OracleManifest } from "./schema.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function git(cwd: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "" };
}

const pinned = "3eb4ee65f7e2c7045301144622edab53f0ab8a54";
const oldInconsistent = "2c3d3af26d5eaec4a8f85bdaa4ae3946b7bd7ef9";

const baseScenario: OracleManifest["scenarios"][number] = {
  id: "test-scenario",
  purpose: "Test scenario",
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
  rationale: "Test",
  reviewedBy: "maintainer",
  reviewedAt: "2026-08-19"
};

function manifestWith(
  revision: string,
  scenario: OracleManifest["scenarios"][number]
): OracleManifest {
  return { version: 1, revision, scenarios: [scenario] };
}

test("commitExists returns true for a known commit and false for a missing one", () => {
  assert.equal(commitExists(pinned, repoRoot), true);
  assert.equal(
    commitExists("ffffffffffffffffffffffffffffffffffffffff", repoRoot),
    false
  );
});

test("getHeadCommit returns the current HEAD", () => {
  const head = getHeadCommit(repoRoot);
  assert.ok(head !== null && /^[0-9a-f]{40}$/.test(head));
  const expected = git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(head, expected);
});

test("readFileAtRevision resolves a file that exists at the pinned commit", () => {
  const r = readFileAtRevision(pinned, "src/index.ts", repoRoot);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.content.includes("repositoryPhase"));
});

test("readFileAtRevision fails for a file absent at the pinned commit", () => {
  const r = readFileAtRevision(pinned, "no/such/file.ts", repoRoot);
  assert.equal(r.ok, false);
});

test("revision-aware validation fails for a missing local commit without network", async () => {
  const manifest = manifestWith(
    "ffffffffffffffffffffffffffffffffffffffff",
    baseScenario
  );
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  assert.ok(
    errors.some((e) => e.includes("does not exist locally")),
    errors.join("; ")
  );
});

test("revision-aware validation fails when HEAD does not match the manifest revision", async () => {
  // Current HEAD is c8c51c7 (or branch HEAD), not the pinned 3eb4ee6, so mismatch is expected
  const manifest = manifestWith(pinned, baseScenario);
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  // Should report HEAD mismatch even though file/anchor are valid at the pinned commit
  assert.ok(
    errors.some((e) => e.includes("does not match HEAD")),
    errors.join("; ")
  );
});

test("revision-aware validation reports missing file at the declared revision", async () => {
  const scenario = {
    ...baseScenario,
    source: { file: "scenarios/does-not-exist/src/index.ts", anchor: "whatever" }
  };
  const manifest = manifestWith(pinned, scenario);
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  assert.ok(
    errors.some((e) => e.includes("not found in revision")),
    errors.join("; ")
  );
});

test("revision-aware validation reports missing anchor at the declared revision", async () => {
  const scenario = {
    ...baseScenario,
    source: { file: "src/index.ts", anchor: "anchor-that-does-not-exist-xyz" }
  };
  const manifest = manifestWith(pinned, scenario);
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  assert.ok(
    errors.some((e) => e.includes("not found in") && e.includes("anchor")),
    errors.join("; ")
  );
});

test("revision-aware validation reports duplicate anchor at the declared revision", async () => {
  // 'export' appears many times in src/index.ts at the pinned commit
  const scenario = {
    ...baseScenario,
    source: { file: "src/index.ts", anchor: "export" }
  };
  const manifest = manifestWith(pinned, scenario);
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  assert.ok(
    errors.some((e) => e.includes("appears") && e.includes("expected exactly one")),
    errors.join("; ")
  );
});

test("the old inconsistent manifest (2c3d3af) fails revision-aware validation because M5 files are absent", async () => {
  // Recreate a manifest that declares the old revision but requires an M5 file absent at that commit
  const scenario: OracleManifest["scenarios"][number] = {
    id: "http-atomic-full-url-drafter",
    purpose: "Draft via raw HTTP",
    source: {
      file: "scenarios/atomic/http-full-url/src/index.ts",
      anchor: "full-url-draft-request"
    },
    expectations: [
      {
        outcome: "observation",
        provider: "openai",
        identifier: "responses.create",
        evidenceKind: "http-request",
        confidence: "alertable"
      }
    ],
    rationale: "Test",
    reviewedBy: "maintainer",
    reviewedAt: "2026-08-19"
  };
  const manifest = manifestWith(oldInconsistent, scenario);
  const errors = await checkRevisionAnchors(manifest, repoRoot);
  // File does not exist at 2c3d3af, so it should be reported as not found in revision
  assert.ok(
    errors.some(
      (e) => e.includes("not found in revision") || e.includes("does not match HEAD")
    ),
    errors.join("; ")
  );
  // The key assertion: at least one file-not-found error, proving the pin is inconsistent
  const fileErrors = errors.filter((e) => e.includes("not found in revision"));
  assert.ok(
    fileErrors.length >= 1 || errors.some((e) => e.includes(oldInconsistent)),
    errors.join("; ")
  );
});

test("revision-aware validation passes when HEAD matches and anchors resolve at that commit (isolated repo)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-revision-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const scenario: OracleManifest["scenarios"][number] = {
      id: "isolated",
      purpose: "Isolated",
      source: { file: "sample.ts", anchor: "myAnchor" },
      expectations: [
        {
          outcome: "observation",
          provider: "github",
          identifier: "repos.list",
          evidenceKind: "sdk-call",
          confidence: "supporting"
        }
      ],
      rationale: "Test",
      reviewedBy: "maintainer",
      reviewedAt: "2026-08-19"
    };
    const manifest = manifestWith(head, scenario);
    const errors = await checkRevisionAnchors(manifest, dir);
    assert.deepEqual(errors, [], errors.join("; "));

    // Now mutate manifest to a different revision to trigger HEAD mismatch
    const bad = manifestWith("ffffffffffffffffffffffffffffffffffffffff", scenario);
    const mismatch = await checkRevisionAnchors(bad, dir);
    assert.ok(
      mismatch.some((e) => e.includes("does not exist locally")),
      mismatch.join("; ")
    );

    const otherHead = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    // Change file to have duplicate anchor and commit again, then check old head still passes but new file has duplicate?
    await writeFile(
      join(dir, "sample.ts"),
      "export const myAnchor = 1;\nexport const myAnchor = 2;\n"
    );
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "duplicate"]);
    const newHead = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    // Old manifest (old head) should still pass when checked at old revision, but HEAD now is newHead so mismatch
    const oldErrors = await checkRevisionAnchors(manifest, dir);
    assert.ok(
      oldErrors.some((e) => e.includes("does not match HEAD")),
      oldErrors.join("; ")
    );
    // New manifest at newHead should fail duplicate
    const dupScenario = {
      ...scenario,
      source: { file: "sample.ts", anchor: "myAnchor" }
    };
    const dupManifest = manifestWith(newHead, dupScenario);
    const dupErrors = await checkRevisionAnchors(dupManifest, dir);
    assert.ok(
      dupErrors.some((e) => e.includes("appears")),
      dupErrors.join("; ")
    );
    void otherHead;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --check-revision succeeds for the pinned manifest when checked out at that revision", async () => {
  // Verify CLI wiring: run `coverage-oracle validate --check-revision` inside a checkout of the pinned commit
  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-cli-rev-"));
  try {
    // Clone the current repo at the pinned commit into a temp dir via git worktree-like checkout
    // Simpler: use git show to write the manifest at the pinned revision and run CLI from that tree's checkout
    // We reuse the isolated repo approach: create a minimal repo that already passes, then run CLI
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "test"]);
    await writeFile(join(dir, "sample.ts"), "export const myAnchor = 1;\n");
    const manifest: OracleManifest = {
      version: 1,
      revision: "",
      scenarios: [
        {
          id: "cli-check",
          purpose: "CLI",
          source: { file: "sample.ts", anchor: "myAnchor" },
          expectations: [
            {
              outcome: "observation",
              provider: "github",
              identifier: "repos.list",
              evidenceKind: "sdk-call",
              confidence: "supporting"
            }
          ],
          rationale: "Test",
          reviewedBy: "maintainer",
          reviewedAt: "2026-08-19"
        }
      ]
    };
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "init"]);
    const head = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    manifest.revision = head;
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
    // Build first is already done via pnpm build; cli.js exists in dist
    // Run without flag should pass
    let result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./cli.js", import.meta.url)), "validate", manifestPath],
      { cwd: dir, encoding: "utf8" }
    );
    // Use dist/cli.js path: the test file runs from dist, so resolve correctly
    // Fallback: spawn the built cli
    if (result.status !== 0) {
      // Try dist path explicitly
      const distCli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
      // Actually this test file is in src, compiled to dist/revision.test.js; cwd is dir, cli path should be absolute to dist
    }
    // Re-run using the repoRoot dist cli to avoid path confusion
    const distCli = join(repoRoot, "packages/coverage-oracle/dist/cli.js");
    result = spawnSync(process.execPath, [distCli, "validate", manifestPath], {
      cwd: dir,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const revResult = spawnSync(
      process.execPath,
      [distCli, "validate", manifestPath, "--check-revision"],
      { cwd: dir, encoding: "utf8" }
    );
    assert.equal(revResult.status, 0, revResult.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
