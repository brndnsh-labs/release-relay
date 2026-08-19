import { Anthropic } from "@anthropic-ai/sdk";
import type {
  CandidateItem,
  DraftFinding,
  DraftReview,
  DraftReviewer,
  DraftReviewOutput,
  DraftReviewRequest,
  OperationId,
  OperationResult,
  SafeErrorClass,
  StructuredReleaseDraft
} from "@release-relay/core";
import {
  citedDraftSourceIdentities,
  draftBodyJsonSchema,
  normalizeStrictDraftBody,
  validateReleaseDraft
} from "@release-relay/core";

const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 4096;

const REVIEW_INSTRUCTIONS =
  "Review the supplied structured release draft body for grounding and quality. " +
  "Every sourceIdentity you cite, in citedSourceIdentities or in any finding, must " +
  "already appear as a sourceIdentity somewhere in the supplied draft. Do not invent " +
  "new source identities, contributors, or facts that are not present in the draft.";

const ALTERNATE_DRAFT_INSTRUCTIONS =
  "Rewrite the supplied structured release draft body as an alternate draft under the " +
  "same schema. Every sourceIdentity you cite must already appear as a sourceIdentity " +
  "somewhere in the supplied draft. Do not invent new source identities, contributors, " +
  "or facts that are not present in the draft.";

const reviewJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    citedSourceIdentities: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", minLength: 1 },
          sourceIdentity: { type: ["string", "null"] }
        },
        required: ["code", "sourceIdentity"],
        additionalProperties: false
      }
    }
  },
  required: ["citedSourceIdentities", "findings"],
  additionalProperties: false
};

export interface AnthropicCreateMessageParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: readonly { role: "user"; content: string }[];
  output_config: { format: { type: "json_schema"; schema: Record<string, unknown> } };
}

export interface AnthropicApi {
  createMessage(params: AnthropicCreateMessageParams): Promise<unknown>;
}

export interface AnthropicRequestOptions {
  model: string;
  maxTokens?: number;
}

export interface AnthropicAlternateDraftOptions extends AnthropicRequestOptions {
  configurationId: string;
  now?: () => Date;
}

export interface LiveAnthropicOptions {
  apiKey: string;
}

type FailureStatus = "refused" | "failed";

class AdapterError extends Error {
  constructor(
    readonly status: FailureStatus,
    readonly errorClass: SafeErrorClass
  ) {
    super("Anthropic adapter response was invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.status === "number") return error.status;
  return isRecord(error.response) && typeof error.response.status === "number"
    ? error.response.status
    : undefined;
}

function classify(error: unknown): {
  status: FailureStatus;
  errorClass: SafeErrorClass;
} {
  if (error instanceof AdapterError) {
    return { status: error.status, errorClass: error.errorClass };
  }
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return { status: "refused", errorClass: "authorization" };
  }
  if (status === 409 || status === 422) {
    return { status: "refused", errorClass: "conflict" };
  }
  if (status === 404) {
    return { status: "refused", errorClass: "not-found" };
  }
  if (status === 429) {
    return { status: "failed", errorClass: "rate-limit" };
  }
  if (status !== undefined && status >= 500) {
    return { status: "failed", errorClass: "unavailable" };
  }
  return { status: "failed", errorClass: "unknown" };
}

function findRecord(
  items: readonly unknown[],
  predicate: (item: Record<string, unknown>) => boolean
): Record<string, unknown> | undefined {
  for (const item of items) {
    if (isRecord(item) && predicate(item)) return item;
  }
  return undefined;
}

// Anthropic reports completion via a top-level stop_reason rather than a
// per-content-block refusal; this extracts the schema-shaped JSON text and
// distinguishes refusal/truncation before that text ever reaches JSON.parse.
function parseMessage(raw: unknown): unknown {
  if (!isRecord(raw)) throw new AdapterError("failed", "invalid-input");
  if (raw.stop_reason === "refusal") {
    throw new AdapterError("refused", "authorization");
  }
  if (
    raw.stop_reason === "max_tokens" ||
    raw.stop_reason === "model_context_window_exceeded"
  ) {
    throw new AdapterError("failed", "unavailable");
  }
  if (raw.stop_reason !== "end_turn" || !Array.isArray(raw.content)) {
    throw new AdapterError("failed", "invalid-input");
  }
  const textBlock = findRecord(
    raw.content,
    (part) => part.type === "text" && typeof part.text === "string"
  );
  if (textBlock === undefined || typeof textBlock.text !== "string") {
    throw new AdapterError("failed", "invalid-input");
  }
  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new AdapterError("failed", "invalid-input");
  }
}

interface ParsedReviewPayload {
  citedSourceIdentities: readonly string[];
  findings: readonly DraftFinding[];
}

function parseReviewPayload(value: unknown): ParsedReviewPayload {
  if (!isRecord(value)) throw new AdapterError("failed", "invalid-input");
  const { citedSourceIdentities, findings } = value;
  if (!isStringArray(citedSourceIdentities) || !Array.isArray(findings)) {
    throw new AdapterError("failed", "invalid-input");
  }
  const parsedFindings: DraftFinding[] = [];
  for (const entry of findings) {
    if (
      !isRecord(entry) ||
      typeof entry.code !== "string" ||
      entry.code.trim() === "" ||
      (entry.sourceIdentity !== null && typeof entry.sourceIdentity !== "string")
    ) {
      throw new AdapterError("failed", "invalid-input");
    }
    parsedFindings.push({
      code: entry.code,
      ...(entry.sourceIdentity === null ? {} : { sourceIdentity: entry.sourceIdentity })
    });
  }
  return { citedSourceIdentities, findings: parsedFindings };
}

// Why: DraftReviewRequest carries only the existing draft, not the original
// candidate list. validateReleaseDraft only reads sourceIdentity off each
// candidate, so a minimal synthetic list bounds re-grounding to identities the
// draft itself already established, without inventing a broader source of truth.
function citedIdentityCandidates(
  draft: StructuredReleaseDraft
): readonly CandidateItem[] {
  return citedDraftSourceIdentities(draft).map((sourceIdentity, order) => ({
    sourceIdentity,
    sourceUrl: "",
    title: "",
    included: true,
    order
  }));
}

function groundingState(
  payload: ParsedReviewPayload,
  allowed: ReadonlySet<string>
): DraftReview["validation"] {
  const cited = [
    ...payload.citedSourceIdentities,
    ...payload.findings.flatMap((finding) =>
      finding.sourceIdentity === undefined ? [] : [finding.sourceIdentity]
    )
  ];
  return cited.every((identity) => allowed.has(identity))
    ? "validated"
    : "validation-failed";
}

async function run<T>(
  operationId: OperationId,
  action: () => Promise<T>
): Promise<OperationResult<T>> {
  try {
    return { status: "completed", operationId, value: await action() };
  } catch (error) {
    return { ...classify(error), operationId };
  }
}

export function createAnthropicDraftReviewer(
  api: AnthropicApi,
  options: AnthropicRequestOptions
): DraftReviewer {
  return {
    review: (request: DraftReviewRequest) =>
      run<DraftReviewOutput>(request.operationId, async () => {
        const raw = await api.createMessage({
          model: options.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: REVIEW_INSTRUCTIONS,
          messages: [{ role: "user", content: JSON.stringify(request.draft.body) }],
          output_config: { format: { type: "json_schema", schema: reviewJsonSchema } }
        });
        const payload = parseReviewPayload(parseMessage(raw));
        const allowed = new Set(citedDraftSourceIdentities(request.draft));
        const review: DraftReview = {
          provider: "anthropic",
          validation: groundingState(payload, allowed),
          citedSourceIdentities: payload.citedSourceIdentities,
          findings: payload.findings
        };
        return { kind: "review", review };
      })
  };
}

export function createAnthropicAlternateDrafter(
  api: AnthropicApi,
  options: AnthropicAlternateDraftOptions
): DraftReviewer {
  const now = options.now ?? (() => new Date());
  return {
    review: (request: DraftReviewRequest) =>
      run<DraftReviewOutput>(request.operationId, async () => {
        const raw = await api.createMessage({
          model: options.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: ALTERNATE_DRAFT_INSTRUCTIONS,
          messages: [{ role: "user", content: JSON.stringify(request.draft.body) }],
          output_config: {
            format: { type: "json_schema", schema: draftBodyJsonSchema }
          }
        });
        const bodyJson = normalizeStrictDraftBody(parseMessage(raw));
        const candidateDraft: unknown = {
          body: bodyJson,
          provenance: {
            provider: "anthropic",
            model: options.model,
            configurationId: options.configurationId,
            generatedAt: now().toISOString(),
            timeSource: "operation-clock"
          }
        };
        const outcome = validateReleaseDraft(
          citedIdentityCandidates(request.draft),
          candidateDraft
        );
        if (!outcome.ok) {
          throw new AdapterError("failed", "invalid-input");
        }
        return { kind: "alternate-draft", draft: outcome.draft };
      })
  };
}

function apiFromClient(client: Anthropic): AnthropicApi {
  // review-adapter-client
  return {
    createMessage: (params) => {
      const createParams: Parameters<typeof client.messages.create>[0] = {
        model: params.model,
        max_tokens: params.max_tokens,
        system: params.system,
        messages: [...params.messages],
        output_config: params.output_config
      };
      return client.messages.create(createParams);
    }
  };
}

export function createAnthropicDraftReviewerFromClient(
  client: Anthropic,
  options: AnthropicRequestOptions
): DraftReviewer {
  return createAnthropicDraftReviewer(apiFromClient(client), options);
}

export function createAnthropicAlternateDrafterFromClient(
  client: Anthropic,
  options: AnthropicAlternateDraftOptions
): DraftReviewer {
  return createAnthropicAlternateDrafter(apiFromClient(client), options);
}

function createLiveClient(options: LiveAnthropicOptions): Anthropic {
  if (options.apiKey.trim() === "") throw new Error("apiKey is required");
  // Why: the SDK falls back to the ANTHROPIC_BASE_URL environment variable when
  // baseURL is omitted; pinning it keeps the host fixed regardless of ambient env.
  return new Anthropic({ apiKey: options.apiKey, baseURL: ANTHROPIC_API_BASE_URL });
}

export function createLiveAnthropicDraftReviewer(
  options: AnthropicRequestOptions & LiveAnthropicOptions
): DraftReviewer {
  return createAnthropicDraftReviewerFromClient(createLiveClient(options), options);
}

export function createLiveAnthropicAlternateDrafter(
  options: AnthropicAlternateDraftOptions & LiveAnthropicOptions
): DraftReviewer {
  return createAnthropicAlternateDrafterFromClient(createLiveClient(options), options);
}
