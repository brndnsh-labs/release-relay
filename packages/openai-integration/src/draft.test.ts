import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateItem } from "@release-relay/core";
import {
  buildDraftInput,
  createOpenAiDrafter,
  type OpenAiApi,
  type OpenAiCreateResponseParams
} from "./draft.js";

const CREATED_AT_SECONDS = 1_800_000_000;

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
    order: 0,
    maintainerAnnotation: "Ship this first"
  },
  {
    sourceIdentity: "issue/7",
    sourceUrl: "https://github.com/example/project/issues/7",
    title: "Clarify setup",
    included: false,
    order: 2
  }
];

function draftBodyText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Release 1.2.0",
    summary: "Two merged changes.",
    supporterNote: null,
    changeGroups: [
      {
        kind: "changed",
        heading: "Changed",
        items: [{ summary: "Improved release notes", sourceIdentities: ["pull/1"] }]
      }
    ],
    acknowledgements: [],
    ...overrides
  });
}

function completedResponse(text: string, overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    created_at: CREATED_AT_SECONDS,
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    ...overrides
  };
}

function apiWith(overrides: Partial<OpenAiApi> = {}): OpenAiApi {
  return {
    createResponse: () => Promise.resolve(completedResponse(draftBodyText())),
    ...overrides
  };
}

function draftWith(api: OpenAiApi) {
  return createOpenAiDrafter(api, { model: "gpt-5.6", configurationId: "config-1" });
}

test("buildDraftInput bounds the request to included candidates and safe fields, ordered", () => {
  assert.deepEqual(buildDraftInput(candidates), [
    {
      sourceIdentity: "pull/2",
      sourceUrl: "https://github.com/example/project/pull/2",
      title: "Document mock mode",
      maintainerAnnotation: "Ship this first"
    },
    {
      sourceIdentity: "pull/1",
      sourceUrl: "https://github.com/example/project/pull/1",
      title: "Improve release notes"
    }
  ]);
});

test("sends only the bounded candidate fields, a strict disabled-storage schema request", async () => {
  let sentParams: OpenAiCreateResponseParams | undefined;
  const api = apiWith({
    createResponse: (params) => {
      sentParams = params;
      return Promise.resolve(completedResponse(draftBodyText()));
    }
  });
  await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.ok(sentParams !== undefined);
  assert.deepEqual(JSON.parse(sentParams.input), buildDraftInput(candidates));
  assert.equal(sentParams.store, false);
  assert.equal(sentParams.text.format.type, "json_schema");
  assert.equal(sentParams.text.format.strict, true);
});

test("a validated draft carries provider-reported provenance from the response", async () => {
  const result = await draftWith(apiWith()).draft({
    operationId: "draft-1",
    candidates
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.kind, "validated-draft");
  if (result.value.kind !== "validated-draft") return;
  assert.deepEqual(result.value.draft.provenance, {
    provider: "openai",
    model: "gpt-5.6",
    configurationId: "config-1",
    generatedAt: new Date(CREATED_AT_SECONDS * 1000).toISOString(),
    timeSource: "provider-reported"
  });
});

test("a null supporterNote from the strict schema is treated as absent", async () => {
  const result = await draftWith(apiWith()).draft({
    operationId: "draft-1",
    candidates
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.kind, "validated-draft");
  if (result.value.kind !== "validated-draft") return;
  assert.equal("supporterNote" in result.value.draft.body, false);
});

test("a model refusal is a refused operation, not a validation outcome", async () => {
  const api = apiWith({
    createResponse: () =>
      Promise.resolve(
        completedResponse("", {
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "cannot help with that" }]
            }
          ]
        })
      )
  });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "draft-1",
    errorClass: "authorization"
  });
});

test("truncated output fails safely instead of parsing partial JSON", async () => {
  const api = apiWith({
    createResponse: () =>
      Promise.resolve({
        status: "incomplete",
        created_at: CREATED_AT_SECONDS,
        incomplete_details: { reason: "max_output_tokens" },
        output: []
      })
  });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "draft-1",
    errorClass: "unavailable"
  });
});

test("a structurally invalid body is a completed operation with an invalid-structure outcome", async () => {
  const api = apiWith({
    createResponse: () =>
      Promise.resolve(
        completedResponse(
          JSON.stringify({
            title: "Release",
            summary: "   ",
            supporterNote: null,
            changeGroups: [],
            acknowledgements: []
          })
        )
      )
  });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, {
    kind: "invalid-structure",
    findings: [{ code: "empty-content" }]
  });
});

test("an invented source citation is a completed operation with an unsupported-claims outcome", async () => {
  const api = apiWith({
    createResponse: () =>
      Promise.resolve(
        completedResponse(
          draftBodyText({
            changeGroups: [
              {
                kind: "changed",
                heading: "Changed",
                items: [
                  { summary: "Improved release notes", sourceIdentities: ["pull/999"] }
                ]
              }
            ]
          })
        )
      )
  });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, {
    kind: "unsupported-claims",
    findings: [{ code: "unknown-source", sourceIdentity: "pull/999" }]
  });
});

test("a citation for an excluded candidate is unsupported", async () => {
  const api = apiWith({
    createResponse: () =>
      Promise.resolve(
        completedResponse(
          draftBodyText({
            changeGroups: [
              {
                kind: "changed",
                heading: "Changed",
                items: [{ summary: "Clarified setup", sourceIdentities: ["issue/7"] }]
              }
            ]
          })
        )
      )
  });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, {
    kind: "unsupported-claims",
    findings: [{ code: "unknown-source", sourceIdentity: "issue/7" }]
  });
});

test("a rate-limited provider call fails with the rate-limit error class", async () => {
  const api = apiWith({ createResponse: () => Promise.reject({ status: 429 }) });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "draft-1",
    errorClass: "rate-limit"
  });
});

test("a provider outage fails safely with the unavailable error class", async () => {
  const api = apiWith({ createResponse: () => Promise.reject({ status: 503 }) });
  const result = await draftWith(api).draft({ operationId: "draft-1", candidates });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "draft-1",
    errorClass: "unavailable"
  });
});
