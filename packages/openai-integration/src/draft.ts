import { OpenAI } from "openai";
import type {
  CandidateItem,
  DraftGeneration,
  DraftRequest,
  OperationId,
  OperationResult,
  ReleaseDrafter,
  SafeErrorClass
} from "@release-relay/core";
import {
  DRAFT_BODY_SCHEMA_NAME,
  draftBodyJsonSchema,
  normalizeStrictDraftBody,
  validateReleaseDraft
} from "@release-relay/core";

export { DRAFT_BODY_SCHEMA_NAME, draftBodyJsonSchema } from "@release-relay/core";

export interface BoundedDraftCandidate {
  sourceIdentity: string;
  sourceUrl: string;
  title: string;
  maintainerAnnotation?: string;
}

export function buildDraftInput(
  candidates: readonly CandidateItem[]
): readonly BoundedDraftCandidate[] {
  return candidates
    .filter((candidate) => candidate.included)
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((candidate) => ({
      sourceIdentity: candidate.sourceIdentity,
      sourceUrl: candidate.sourceUrl,
      title: candidate.title,
      ...(candidate.maintainerAnnotation === undefined
        ? {}
        : { maintainerAnnotation: candidate.maintainerAnnotation })
    }));
}

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

const DRAFT_INSTRUCTIONS =
  "Draft a structured open-source release summary strictly from the supplied " +
  "candidate list. Every citation in changeGroups and acknowledgements must " +
  "reference a supplied sourceIdentity. Do not invent changes, contributors, " +
  "or sources that are not present in the input.";

export interface OpenAiCreateResponseParams {
  model: string;
  input: string;
  instructions: string;
  store: false;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
}

export interface OpenAiApi {
  createResponse(params: OpenAiCreateResponseParams): Promise<unknown>;
}

export interface OpenAiDrafterOptions {
  model: string;
  configurationId: string;
}

export interface LiveOpenAiDrafterOptions extends OpenAiDrafterOptions {
  apiKey: string;
}

type FailureStatus = "refused" | "failed";

class AdapterError extends Error {
  constructor(
    readonly status: FailureStatus,
    readonly errorClass: SafeErrorClass
  ) {
    super("OpenAI drafter response was invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

interface ParsedResponse {
  bodyJson: unknown;
  createdAtSeconds: number;
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

// Postconditions live in @release-relay/core's validateReleaseDraft; this parser
// only extracts the schema-shaped JSON text from the transport envelope and
// distinguishes refusal/incomplete before that text ever reaches the parser.
function parseResponse(raw: unknown): ParsedResponse {
  if (!isRecord(raw)) throw new AdapterError("failed", "invalid-input");
  const createdAtSeconds = raw.created_at;
  if (typeof createdAtSeconds !== "number" || !Number.isFinite(createdAtSeconds)) {
    throw new AdapterError("failed", "invalid-input");
  }
  if (raw.status === "incomplete" || raw.status === "failed") {
    throw new AdapterError("failed", "unavailable");
  }
  if (raw.status !== "completed" || !Array.isArray(raw.output)) {
    throw new AdapterError("failed", "invalid-input");
  }
  const message = findRecord(raw.output, (item) => item.type === "message");
  if (message === undefined || !Array.isArray(message.content)) {
    throw new AdapterError("failed", "invalid-input");
  }
  const refusal = findRecord(message.content, (part) => part.type === "refusal");
  if (refusal !== undefined) {
    throw new AdapterError("refused", "authorization");
  }
  const outputText = findRecord(
    message.content,
    (part) => part.type === "output_text" && typeof part.text === "string"
  );
  if (outputText === undefined || typeof outputText.text !== "string") {
    throw new AdapterError("failed", "invalid-input");
  }
  try {
    return { bodyJson: JSON.parse(outputText.text), createdAtSeconds };
  } catch {
    throw new AdapterError("failed", "invalid-input");
  }
}

async function run(
  operationId: OperationId,
  action: () => Promise<DraftGeneration>
): Promise<OperationResult<DraftGeneration>> {
  try {
    return { status: "completed", operationId, value: await action() };
  } catch (error) {
    return { ...classify(error), operationId };
  }
}

export function createOpenAiDrafter(
  api: OpenAiApi,
  options: OpenAiDrafterOptions
): ReleaseDrafter {
  return {
    draft: (request: DraftRequest) =>
      run(request.operationId, async () => {
        const boundedCandidates = buildDraftInput(request.candidates);
        const raw = await api.createResponse({
          model: options.model,
          input: JSON.stringify(boundedCandidates),
          instructions: DRAFT_INSTRUCTIONS,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: DRAFT_BODY_SCHEMA_NAME,
              strict: true,
              schema: draftBodyJsonSchema
            }
          }
        });
        const { bodyJson, createdAtSeconds } = parseResponse(raw);
        const candidateDraft: unknown = {
          body: normalizeStrictDraftBody(bodyJson),
          provenance: {
            provider: "openai",
            model: options.model,
            configurationId: options.configurationId,
            generatedAt: new Date(createdAtSeconds * 1000).toISOString(),
            timeSource: "provider-reported"
          }
        };
        const outcome = validateReleaseDraft(request.candidates, candidateDraft);
        return outcome.ok
          ? { kind: "validated-draft", draft: outcome.draft }
          : { kind: outcome.reason, findings: outcome.findings };
      })
  };
}

function apiFromClient(client: OpenAI): OpenAiApi {
  // draft-adapter-client
  return {
    createResponse: (params) =>
      client.responses.create(params as Parameters<typeof client.responses.create>[0])
  };
}

export function createOpenAiDrafterFromClient(
  client: OpenAI,
  options: OpenAiDrafterOptions
): ReleaseDrafter {
  return createOpenAiDrafter(apiFromClient(client), options);
}

export function createLiveOpenAiDrafter(
  options: LiveOpenAiDrafterOptions
): ReleaseDrafter {
  if (options.apiKey.trim() === "") throw new Error("apiKey is required");
  // Why: the SDK falls back to the OPENAI_BASE_URL environment variable when
  // baseURL is omitted; pinning it keeps the host fixed regardless of ambient env.
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: OPENAI_API_BASE_URL });
  return createOpenAiDrafterFromClient(client, options);
}
