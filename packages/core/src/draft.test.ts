import assert from "node:assert/strict";
import test from "node:test";
import {
  changeGroupKinds,
  citedDraftSourceIdentities,
  draftTimeSources,
  validateReleaseDraft,
  type StructuredReleaseDraft
} from "./draft.js";
import type { CandidateItem } from "./workspace.js";

const candidates: readonly CandidateItem[] = [
  {
    sourceIdentity: "pull/1",
    sourceUrl: "https://github.com/example/project/pull/1",
    title: "Improve release notes",
    included: true,
    order: 1
  },
  {
    sourceIdentity: "pull/2",
    sourceUrl: "https://github.com/example/project/pull/2",
    title: "Document mock mode",
    included: true,
    order: 2
  },
  {
    sourceIdentity: "issue/7",
    sourceUrl: "https://github.com/example/project/issues/7",
    title: "Clarify setup",
    included: false,
    order: 3
  }
];

function validDraftValue(): unknown {
  return {
    body: {
      title: "Release 1.2.0",
      summary: "Two merged changes and one clarification.",
      changeGroups: [
        {
          kind: "changed",
          heading: "Changed",
          items: [{ summary: "Improved release notes", sourceIdentities: ["pull/1"] }]
        },
        {
          kind: "fixed",
          heading: "Fixed",
          items: [{ summary: "Documented mock mode", sourceIdentities: ["pull/2"] }]
        }
      ],
      acknowledgements: [{ contributor: "maintainer", sourceIdentities: ["pull/1"] }],
      supporterNote: "Sponsors received these improvements first."
    },
    provenance: {
      provider: "openai",
      model: "draft-model-1",
      configurationId: "config-1",
      generatedAt: "2026-02-03T04:05:06.000Z",
      timeSource: "operation-clock"
    }
  };
}

test("a fully grounded draft validates and keeps its provenance", () => {
  const outcome = validateReleaseDraft(candidates, validDraftValue());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  assert.deepEqual(outcome.draft.provenance, {
    provider: "openai",
    model: "draft-model-1",
    configurationId: "config-1",
    generatedAt: "2026-02-03T04:05:06.000Z",
    timeSource: "operation-clock"
  });
  assert.deepEqual(citedDraftSourceIdentities(outcome.draft), ["pull/1", "pull/2"]);
});

test("a draft may omit supplied candidates without failing", () => {
  const value = validDraftValue() as { body: { changeGroups: unknown[] } };
  value.body.changeGroups = value.body.changeGroups.slice(0, 1);
  const outcome = validateReleaseDraft(candidates, value);
  assert.equal(outcome.ok, true);
});

test("unknown output fields are rejected as invalid structure", () => {
  const value = validDraftValue() as Record<string, unknown> & {
    body: Record<string, unknown>;
  };
  value.body.extra = "unexpected";
  const outcome = validateReleaseDraft(candidates, value);
  assert.deepEqual(outcome, {
    ok: false,
    reason: "invalid-structure",
    findings: [{ code: "invalid-body" }]
  });
});

test("empty useful content is rejected as invalid structure", () => {
  const value = validDraftValue() as { body: Record<string, unknown> };
  value.body.summary = "   ";
  const outcome = validateReleaseDraft(candidates, value);
  assert.deepEqual(outcome, {
    ok: false,
    reason: "invalid-structure",
    findings: [{ code: "empty-content" }]
  });
});

test("invalid provenance identity is rejected as invalid structure", () => {
  const value = validDraftValue() as { provenance: Record<string, unknown> };
  value.provenance.timeSource = "wall-clock";
  const outcome = validateReleaseDraft(candidates, value);
  assert.deepEqual(outcome, {
    ok: false,
    reason: "invalid-structure",
    findings: [{ code: "invalid-time-source" }]
  });
});

test("invented and missing source identities are unsupported claims", () => {
  const value = validDraftValue() as {
    body: {
      changeGroups: { items: { sourceIdentities: string[] }[] }[];
      acknowledgements: { sourceIdentities: string[] }[];
    };
  };
  const fixedGroup = value.body.changeGroups[1];
  const acknowledgement = value.body.acknowledgements[0];
  assert.ok(fixedGroup !== undefined && acknowledgement !== undefined);
  fixedGroup.items[0]?.sourceIdentities.splice(0, 1, "pull/999");
  acknowledgement.sourceIdentities = ["issue/404"];
  const outcome = validateReleaseDraft(candidates, value);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.equal(outcome.reason, "unsupported-claims");
  assert.deepEqual(outcome.findings, [
    { code: "unknown-source", sourceIdentity: "pull/999" },
    { code: "unknown-source", sourceIdentity: "issue/404" }
  ]);
});

test("cross-group duplicate citations are unsupported claims", () => {
  const value = validDraftValue() as {
    body: { changeGroups: { items: { sourceIdentities: string[] }[] }[] };
  };
  const fixedGroup = value.body.changeGroups[1];
  assert.ok(fixedGroup !== undefined);
  fixedGroup.items[0]?.sourceIdentities.splice(0, 2, "pull/1", "pull/2");
  const outcome = validateReleaseDraft(candidates, value);
  assert.deepEqual(outcome, {
    ok: false,
    reason: "unsupported-claims",
    findings: [{ code: "duplicate-citation", sourceIdentity: "pull/1" }]
  });
});

test("non-object input is rejected as invalid structure", () => {
  for (const value of [null, undefined, "draft", 42, [], () => {}]) {
    assert.deepEqual(validateReleaseDraft(candidates, value), {
      ok: false,
      reason: "invalid-structure",
      findings: [{ code: "invalid-draft" }]
    });
  }
});

test("contract enums expose the reviewed vocabulary", () => {
  assert.deepEqual(changeGroupKinds, [
    "added",
    "changed",
    "fixed",
    "deprecated",
    "removed",
    "security"
  ]);
  assert.deepEqual(draftTimeSources, ["operation-clock", "provider-reported"]);
});

test("validated drafts carry the strict output shape", () => {
  const outcome = validateReleaseDraft(candidates, validDraftValue());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const draft: StructuredReleaseDraft = outcome.draft;
  assert.equal("content" in draft, false);
  assert.equal("validation" in draft.provenance, false);
  assert.equal("sourceIdentities" in draft.provenance, false);
});
