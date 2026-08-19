import assert from "node:assert/strict";
import test from "node:test";
import {
  addRevision,
  createWorkspace,
  publishWorkspace,
  transition,
  updateCandidates,
  type CandidateItem,
  type ReleaseWorkspace
} from "./workspace.js";

const candidate: CandidateItem = {
  sourceIdentity: "pull/42",
  sourceUrl: "https://github.com/example/project/pull/42",
  title: "Improve release notes",
  included: true,
  order: 1,
  maintainerAnnotation: "Mention the migration note"
};

function unwrap(result: ReturnType<typeof transition>): ReleaseWorkspace {
  assert.equal(result.ok, true);
  return result.workspace;
}

function move(workspace: ReleaseWorkspace, state: Parameters<typeof transition>[1]) {
  return unwrap(transition(workspace, state));
}

test("every allowed lifecycle transition succeeds", () => {
  let workspace = createWorkspace("release-1");
  workspace = move(workspace, "drafting");
  workspace = move(workspace, "collecting");
  workspace = move(workspace, "drafting");
  workspace = move(workspace, "review");
  workspace = move(workspace, "drafting");
  workspace = move(workspace, "review");
  workspace = move(workspace, "approved");
  assert.equal(workspace.state, "approved");
});

test("candidate items and revision origins are retained", () => {
  let workspace = createWorkspace("release-1");
  workspace = unwrap(updateCandidates(workspace, [candidate]));
  workspace = move(workspace, "drafting");
  workspace = unwrap(
    addRevision(workspace, {
      id: "draft-1",
      origin: "generated",
      provider: "openai",
      model: "draft-model-1",
      configurationId: "config-1",
      generatedAt: "2026-02-03T04:05:06.000Z",
      timeSource: "operation-clock",
      body: {
        title: "Release",
        summary: "Summary",
        changeGroups: [
          {
            kind: "changed",
            heading: "Changed",
            items: [
              { summary: candidate.title, sourceIdentities: [candidate.sourceIdentity] }
            ]
          }
        ],
        acknowledgements: []
      }
    })
  );
  const human = {
    id: "draft-2",
    origin: "human" as const,
    parentRevisionId: "draft-1",
    body: {
      title: "Edited release",
      summary: "Edited summary",
      changeGroups: [],
      acknowledgements: []
    }
  };
  workspace = unwrap(addRevision(workspace, human));
  assert.deepEqual(workspace.candidates, [candidate]);
  const generated = workspace.revisions[0];
  const edited = workspace.revisions[1];
  assert.equal(generated?.origin, "generated");
  assert.equal(edited?.origin, "human");
  assert.equal("provider" in (edited ?? {}), false);
  assert.equal(edited?.parentRevisionId, generated?.id);
});

test("revision lineage rejects unknown parents and duplicate ids", () => {
  let workspace = createWorkspace("release-1");
  workspace = move(workspace, "drafting");
  assert.deepEqual(
    addRevision(workspace, {
      id: "draft-1",
      origin: "human",
      parentRevisionId: "missing-revision",
      body: { title: "No", summary: "No", changeGroups: [], acknowledgements: [] }
    }),
    { ok: false, error: "revision-parent-unknown" }
  );
  workspace = unwrap(
    addRevision(workspace, {
      id: "draft-1",
      origin: "human",
      body: { title: "Yes", summary: "Yes", changeGroups: [], acknowledgements: [] }
    })
  );
  assert.deepEqual(
    addRevision(workspace, {
      id: "draft-1",
      origin: "human",
      body: { title: "Again", summary: "Again", changeGroups: [], acknowledgements: [] }
    }),
    { ok: false, error: "revision-id-already-used" }
  );
});

test("invalid transitions reject skipped approval and published edits", () => {
  const collecting = createWorkspace("release-1");
  for (const state of ["review", "approved", "published"] as const) {
    assert.deepEqual(transition(collecting, state), {
      ok: false,
      error: "transition-not-allowed"
    });
  }

  let approved = createWorkspace("release-1");
  approved = move(approved, "drafting");
  approved = move(approved, "review");
  approved = move(approved, "approved");
  const attempted = publishWorkspace(approved, {
    status: "attempted",
    operationId: "operation-1"
  });
  assert.deepEqual(attempted, { ok: false, error: "publish-result-not-confirmed" });

  const published = unwrap(
    publishWorkspace(approved, {
      status: "completed",
      url: "https://github.com/example/project/releases/tag/v1"
    })
  );
  assert.equal(published.state, "published");
  assert.deepEqual(updateCandidates(published, []), {
    ok: false,
    error: "published-workspace-is-immutable"
  });
  assert.deepEqual(
    addRevision(published, {
      id: "draft-3",
      origin: "human",
      body: { title: "No", summary: "No", changeGroups: [], acknowledgements: [] }
    }),
    { ok: false, error: "published-workspace-is-immutable" }
  );
});
