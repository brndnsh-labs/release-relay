import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

async function createRepo(files: Record<string, string>): Promise<{
  dir: string;
  head: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-revision-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@test.com"]);
  git(dir, ["config", "user.name", "test"]);
  for (const [file, content] of Object.entries(files)) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return { dir, head: git(dir, ["rev-parse", "HEAD"]).stdout.trim() };
}

test("commitExists returns true for a known commit and false for a missing one", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    assert.equal(commitExists(repo.head, repo.dir), true);
    assert.equal(
      commitExists("ffffffffffffffffffffffffffffffffffffffff", repo.dir),
      false
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("getHeadCommit returns the current HEAD", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const head = getHeadCommit(repo.dir);
    assert.ok(head !== null && /^[0-9a-f]{40}$/.test(head));
    assert.equal(head, repo.head);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("readFileAtRevision resolves a file that exists at the pinned commit", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const r = readFileAtRevision(repo.head, "src/index.ts", repo.dir);
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.content.includes("repositoryPhase"));
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("readFileAtRevision fails for a file absent at the pinned commit", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const r = readFileAtRevision(repo.head, "no/such/file.ts", repo.dir);
    assert.equal(r.ok, false);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("revision-aware validation fails for a missing local commit without network", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  const manifest = manifestWith(
    "ffffffffffffffffffffffffffffffffffffffff",
    baseScenario
  );
  try {
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("does not exist locally")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("revision-aware validation fails when HEAD does not match the manifest revision", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const manifest = manifestWith(repo.head, baseScenario);
    await writeFile(
      join(repo.dir, "src/index.ts"),
      "export const repositoryPhase = 2;\n"
    );
    git(repo.dir, ["add", "."]);
    git(repo.dir, ["commit", "-m", "second"]);
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("does not match HEAD")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("revision-aware validation reports missing file at the declared revision", async () => {
  const scenario = {
    ...baseScenario,
    source: { file: "scenarios/does-not-exist/src/index.ts", anchor: "whatever" }
  };
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const manifest = manifestWith(repo.head, scenario);
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("not found in revision")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("revision-aware validation reports missing anchor at the declared revision", async () => {
  const scenario = {
    ...baseScenario,
    source: { file: "src/index.ts", anchor: "anchor-that-does-not-exist-xyz" }
  };
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const manifest = manifestWith(repo.head, scenario);
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("not found in") && e.includes("anchor")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("revision-aware validation reports duplicate anchor at the declared revision", async () => {
  const scenario = {
    ...baseScenario,
    source: { file: "src/index.ts", anchor: "export" }
  };
  const repo = await createRepo({
    "src/index.ts":
      "export const repositoryPhase = 1;\nexport const repositoryPhase = 2;\n"
  });
  try {
    const manifest = manifestWith(repo.head, scenario);
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("appears") && e.includes("expected exactly one")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test("a manifest fails revision-aware validation when its declared revision lacks an M5 file", async () => {
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
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  try {
    const manifest = manifestWith(repo.head, scenario);
    const errors = await checkRevisionAnchors(manifest, repo.dir);
    assert.ok(
      errors.some((e) => e.includes("not found in revision")),
      errors.join("; ")
    );
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
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
  // Keep the manifest/tool checkout separate from the clean pinned source root.
  const dir = await mkdtemp(join(tmpdir(), "coverage-oracle-cli-rev-"));
  const toolDir = await mkdtemp(join(tmpdir(), "coverage-oracle-cli-tool-"));
  try {
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
    const manifestPath = join(toolDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const distCli = join(repoRoot, "packages/coverage-oracle/dist/cli.js");
    const result = spawnSync(
      process.execPath,
      [distCli, "validate", manifestPath, "--source-root", dir],
      {
        cwd: toolDir,
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const revResult = spawnSync(
      process.execPath,
      [distCli, "validate", manifestPath, "--source-root", dir, "--check-revision"],
      { cwd: toolDir, encoding: "utf8" }
    );
    assert.equal(revResult.status, 0, revResult.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(toolDir, { recursive: true, force: true });
  }
});

test("CLI validation rejects a source path that escapes through a symlink", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n"
  });
  const toolDir = await mkdtemp(join(tmpdir(), "coverage-oracle-cli-tool-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "coverage-oracle-outside-"));
  try {
    const outsideFile = join(outsideDir, "outside.ts");
    await writeFile(outsideFile, "export const escapedAnchor = 1;\n");
    await symlink(outsideFile, join(repo.dir, "linked.ts"));
    git(repo.dir, ["add", "linked.ts"]);
    git(repo.dir, ["commit", "-m", "link"]);
    const manifest = manifestWith(git(repo.dir, ["rev-parse", "HEAD"]).stdout.trim(), {
      ...baseScenario,
      source: { file: "linked.ts", anchor: "escapedAnchor" }
    });
    const manifestPath = join(toolDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    const distCli = join(repoRoot, "packages/coverage-oracle/dist/cli.js");
    const result = spawnSync(
      process.execPath,
      [distCli, "validate", manifestPath, "--source-root", repo.dir],
      { cwd: toolDir, encoding: "utf8" }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /linked\.ts is outside source root/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
    await rm(toolDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("revision-aware validation proves expectation location anchors exactly once", async () => {
  const repo = await createRepo({
    "src/index.ts": "export const repositoryPhase = 1;\n",
    "src/calls.ts": "export const one = 1;\nexport const two = 2;\n"
  });
  try {
    const located: OracleManifest["scenarios"][number] = {
      ...baseScenario,
      source: { file: "src/index.ts", anchor: "repositoryPhase" },
      expectations: [
        {
          outcome: "observation",
          id: "test-scenario.repos.list",
          provider: "github",
          identifier: "repos.list",
          evidenceKind: "sdk-call",
          confidence: "supporting",
          locationAnchor: { file: "src/calls.ts", anchor: "export const one" }
        }
      ]
    };
    const ok = await checkRevisionAnchors(
      { version: 2, revision: repo.head, scenarios: [located] },
      repo.dir
    );
    assert.deepEqual(ok, []);

    const missing = await checkRevisionAnchors(
      {
        version: 2,
        revision: repo.head,
        scenarios: [
          {
            ...located,
            expectations: [
              {
                ...located.expectations[0]!,
                locationAnchor: { file: "src/calls.ts", anchor: "absent-anchor" }
              }
            ]
          }
        ]
      },
      repo.dir
    );
    assert.equal(missing.length, 1);
    assert.match(
      missing[0]!,
      /test-scenario\.repos\.list: anchor absent-anchor not found/
    );

    const duplicated = await checkRevisionAnchors(
      {
        version: 2,
        revision: repo.head,
        scenarios: [
          {
            ...located,
            expectations: [
              {
                ...located.expectations[0]!,
                locationAnchor: { file: "src/calls.ts", anchor: "export const" }
              }
            ]
          }
        ]
      },
      repo.dir
    );
    assert.equal(duplicated.length, 1);
    assert.match(duplicated[0]!, /appears 2 times/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});
