import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredReleaseDraft } from "@release-relay/core";
import {
  createAnthropicAlternateDrafter,
  createAnthropicDraftReviewer,
  type AnthropicApi,
  type AnthropicCreateMessageParams
} from "./review.js";

const CREATED_AT = "2027-03-01T09:00:00.000Z";

function inputDraft(): StructuredReleaseDraft {
  return {
    body: {
      title: "Release 1.3.0",
      summary: "One merged change.",
      changeGroups: [
        {
          kind: "changed",
          heading: "Changed",
          items: [{ summary: "Improved release notes", sourceIdentities: ["pull/1"] }]
        }
      ],
      acknowledgements: [{ contributor: "maintainer", sourceIdentities: ["pull/1"] }]
    },
    provenance: {
      provider: "openai",
      model: "gpt-5.6",
      configurationId: "config-1",
      generatedAt: "2027-01-15T08:00:00.000Z",
      timeSource: "provider-reported"
    }
  };
}

function messageResponse(text: string, overrides: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
    ...overrides
  };
}

function reviewPayloadText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    citedSourceIdentities: ["pull/1"],
    findings: [],
    ...overrides
  });
}

function alternateDraftText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: "Release 1.3.0, reworded",
    summary: "One merged change, reworded.",
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

function apiWith(overrides: Partial<AnthropicApi> = {}): AnthropicApi {
  return {
    createMessage: () => Promise.resolve(messageResponse(reviewPayloadText())),
    ...overrides
  };
}

function reviewerWith(api: AnthropicApi) {
  return createAnthropicDraftReviewer(api, { model: "claude-opus-5" });
}

function alternateDrafterWith(api: AnthropicApi) {
  return createAnthropicAlternateDrafter(api, {
    model: "claude-opus-5",
    configurationId: "config-1",
    now: () => new Date(CREATED_AT)
  });
}

test("a review sends only the draft body, not its provenance, as a single message", async () => {
  let sentParams: AnthropicCreateMessageParams | undefined;
  const api = apiWith({
    createMessage: (params) => {
      sentParams = params;
      return Promise.resolve(messageResponse(reviewPayloadText()));
    }
  });
  await reviewerWith(api).review({ operationId: "review-1", draft: inputDraft() });
  assert.ok(sentParams !== undefined);
  assert.equal(sentParams.messages.length, 1);
  const [message] = sentParams.messages;
  assert.ok(message !== undefined);
  assert.deepEqual(JSON.parse(message.content), inputDraft().body);
  assert.equal(sentParams.output_config.format.type, "json_schema");
});

test("a fully grounded review validates and preserves its findings", async () => {
  const result = await reviewerWith(apiWith()).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.kind, "review");
  if (result.value.kind !== "review") return;
  assert.deepEqual(result.value.review, {
    provider: "anthropic",
    validation: "validated",
    citedSourceIdentities: ["pull/1"],
    findings: []
  });
});

test("a review citing an identity absent from the draft fails grounding, not the operation", async () => {
  const api = apiWith({
    createMessage: () =>
      Promise.resolve(
        messageResponse(
          reviewPayloadText({
            findings: [{ code: "unsupported-claim", sourceIdentity: "pull/999" }]
          })
        )
      )
  });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.kind, "review");
  if (result.value.kind !== "review") return;
  assert.equal(result.value.review.validation, "validation-failed");
});

test("a model refusal is a refused operation", async () => {
  const api = apiWith({
    createMessage: () => Promise.resolve({ stop_reason: "refusal", content: [] })
  });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "review-1",
    errorClass: "authorization"
  });
});

test("truncated output fails safely instead of parsing partial JSON", async () => {
  const api = apiWith({
    createMessage: () => Promise.resolve({ stop_reason: "max_tokens", content: [] })
  });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "review-1",
    errorClass: "unavailable"
  });
});

test("a malformed review payload fails safely", async () => {
  const api = apiWith({
    createMessage: () =>
      Promise.resolve(
        messageResponse(JSON.stringify({ citedSourceIdentities: ["pull/1"] }))
      )
  });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "review-1",
    errorClass: "invalid-input"
  });
});

test("a rate-limited provider call fails with the rate-limit error class", async () => {
  const api = apiWith({ createMessage: () => Promise.reject({ status: 429 }) });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "review-1",
    errorClass: "rate-limit"
  });
});

test("a provider outage fails safely with the unavailable error class", async () => {
  const api = apiWith({ createMessage: () => Promise.reject({ status: 503 }) });
  const result = await reviewerWith(api).review({
    operationId: "review-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "review-1",
    errorClass: "unavailable"
  });
});

test("a grounded alternate draft validates with operation-clock provenance", async () => {
  const api = apiWith({
    createMessage: () => Promise.resolve(messageResponse(alternateDraftText()))
  });
  const result = await alternateDrafterWith(api).review({
    operationId: "alt-1",
    draft: inputDraft()
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.kind, "alternate-draft");
  if (result.value.kind !== "alternate-draft") return;
  assert.deepEqual(result.value.draft.provenance, {
    provider: "anthropic",
    model: "claude-opus-5",
    configurationId: "config-1",
    generatedAt: CREATED_AT,
    timeSource: "operation-clock"
  });
  assert.equal("supporterNote" in result.value.draft.body, false);
});

test("an alternate draft inventing a new source citation fails the operation", async () => {
  const api = apiWith({
    createMessage: () =>
      Promise.resolve(
        messageResponse(
          alternateDraftText({
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
  const result = await alternateDrafterWith(api).review({
    operationId: "alt-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "alt-1",
    errorClass: "invalid-input"
  });
});

test("an alternate-draft refusal is a refused operation", async () => {
  const api = apiWith({
    createMessage: () => Promise.resolve({ stop_reason: "refusal", content: [] })
  });
  const result = await alternateDrafterWith(api).review({
    operationId: "alt-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "alt-1",
    errorClass: "authorization"
  });
});

test("an alternate-draft rate-limited call fails with the rate-limit error class", async () => {
  const api = apiWith({ createMessage: () => Promise.reject({ status: 429 }) });
  const result = await alternateDrafterWith(api).review({
    operationId: "alt-1",
    draft: inputDraft()
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "alt-1",
    errorClass: "rate-limit"
  });
});
