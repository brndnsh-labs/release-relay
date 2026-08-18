import { createHash } from "node:crypto";
import { assembleCandidates } from "@release-relay/github-integration";
import type {
  AiProvider,
  CandidateItem,
  ComparisonRange,
  ComparisonResult,
  ConfirmedReleasePublication,
  ContributorSummary,
  DraftRequest,
  DraftReviewOutput,
  DraftReviewRequest,
  DraftReviewer,
  GitHubPublisher,
  GitHubReader,
  IssueSummary,
  MembershipProjection,
  OperationId,
  OperationLedger,
  OperationLedgerEntry,
  OperationLedgerEntryInput,
  OperationResult,
  PortalSession,
  Provider,
  PublishedRelease,
  PullRequestSummary,
  ReleaseDrafter,
  ReleasePublicationRequest,
  ReleasePreview,
  ReleaseSummary,
  RepositoryRef,
  RepositorySummary,
  SafeErrorClass,
  SponsorBilling,
  SponsorTier,
  StripeWebhookProjector,
  StructuredReleaseDraft,
  VerifiedWebhookEvent,
  CheckoutSession
} from "@release-relay/core";

export type MockOutcome = "completed" | "refused" | "failed";

export interface MockRuntimeOptions {
  seed?: string;
  startAt?: string;
  draftProvider?: AiProvider;
  reviewProvider?: AiProvider;
  scriptedOutcomes?: Partial<Record<Provider, readonly MockOutcome[]>>;
}

export interface MockRuntime {
  readonly ledger: OperationLedger;
  readonly reader: GitHubReader;
  readonly publisher: GitHubPublisher;
  readonly drafter: ReleaseDrafter;
  readonly reviewer: DraftReviewer;
  readonly billing: SponsorBilling;
  readonly webhookProjector: StripeWebhookProjector;
  nextOperationId(operation: string): OperationId;
  assembleCandidates(input: {
    operationId: OperationId;
    repository: RepositoryRef;
    range: ComparisonRange;
  }): Promise<OperationResult<readonly CandidateItem[]>>;
}

interface StoredOperation {
  provider: Provider;
  operation: string;
  resourceId: string | undefined;
  value: unknown;
}

const DEFAULT_START = "2026-01-01T00:00:00.000Z";

function stableId(seed: string, ...parts: readonly string[]): string {
  return createHash("sha256")
    .update([seed, ...parts].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function errorClass(outcome: Exclude<MockOutcome, "completed">): SafeErrorClass {
  return outcome === "refused" ? "authorization" : "unavailable";
}

class MockLedger implements OperationLedger {
  private readonly recorded: OperationLedgerEntry[] = [];

  constructor(private readonly nextTimestamp: () => string) {}

  record(entry: OperationLedgerEntryInput): void {
    this.recorded.push({ ...entry, recordedAt: this.nextTimestamp() });
  }

  entries(): readonly OperationLedgerEntry[] {
    return this.recorded.slice();
  }
}

class MockEngine {
  private readonly completed = new Map<OperationId, StoredOperation>();
  private readonly scripts: Map<Provider, MockOutcome[]>;

  constructor(
    private readonly seed: string,
    private readonly ledger: MockLedger,
    scriptedOutcomes: Partial<Record<Provider, readonly MockOutcome[]>>
  ) {
    this.scripts = new Map(
      ["github", "openai", "anthropic", "stripe"].map((provider) => [
        provider as Provider,
        [...(scriptedOutcomes[provider as Provider] ?? [])]
      ])
    );
  }

  id(operation: string, operationId: OperationId): string {
    return stableId(this.seed, operation, operationId);
  }

  execute<T>(input: {
    provider: Provider;
    operation: string;
    operationId: OperationId;
    resourceId?: string;
    createValue: () => T;
  }): OperationResult<T> {
    const previous = this.completed.get(input.operationId);
    if (previous !== undefined) {
      if (
        previous.provider !== input.provider ||
        previous.operation !== input.operation
      ) {
        const result: OperationResult<T> = {
          status: "failed",
          operationId: input.operationId,
          errorClass: "conflict"
        };
        this.ledger.record({
          operationId: input.operationId,
          provider: input.provider,
          operation: input.operation,
          status: result.status,
          errorClass: result.errorClass
        });
        return result;
      }
      const result: OperationResult<T> = {
        status: "duplicate",
        operationId: input.operationId,
        value: previous.value as T
      };
      this.ledger.record({
        operationId: input.operationId,
        provider: input.provider,
        operation: input.operation,
        status: result.status,
        ...(previous.resourceId === undefined
          ? {}
          : { resourceId: previous.resourceId })
      });
      return result;
    }

    const outcome = this.scripts.get(input.provider)?.shift() ?? "completed";
    if (outcome !== "completed") {
      const failureClass = errorClass(outcome);
      const result: OperationResult<T> = {
        status: outcome,
        operationId: input.operationId,
        errorClass: failureClass
      };
      this.ledger.record({
        operationId: input.operationId,
        provider: input.provider,
        operation: input.operation,
        status: result.status,
        errorClass: failureClass
      });
      return result;
    }

    const value = input.createValue();
    this.completed.set(input.operationId, {
      provider: input.provider,
      operation: input.operation,
      resourceId: input.resourceId,
      value
    });
    const result: OperationResult<T> = {
      status: "completed",
      operationId: input.operationId,
      value
    };
    this.ledger.record({
      operationId: input.operationId,
      provider: input.provider,
      operation: input.operation,
      status: result.status,
      ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId })
    });
    return result;
  }
}

class DeterministicClock {
  private tick = 0;

  constructor(startAt: string) {
    if (Number.isNaN(Date.parse(startAt))) {
      throw new Error("startAt must be an ISO timestamp");
    }
    this.startAt = Date.parse(startAt);
  }

  private readonly startAt: number;

  next(): string {
    return new Date(this.startAt + this.tick++ * 1000).toISOString();
  }
}

function repositoryValue(seed: string, repository: RepositoryRef): RepositorySummary {
  return {
    ...repository,
    id: stableId(seed, "repository", repository.owner, repository.name),
    url: `https://github.com/${repository.owner}/${repository.name}`
  };
}

function comparisonValue(
  repository: RepositoryRef,
  range: ComparisonRange
): ComparisonResult {
  const base = `https://github.com/${repository.owner}/${repository.name}`;
  const pullRequests: readonly PullRequestSummary[] = [
    {
      sourceIdentity: "pull/1",
      url: `${base}/pull/1`,
      title: "Improve release notes",
      merged: true,
      reverted: false,
      linkedIssueIdentities: []
    },
    {
      sourceIdentity: "pull/2",
      url: `${base}/pull/2`,
      title: "Document mock mode",
      merged: true,
      reverted: false,
      linkedIssueIdentities: []
    }
  ];
  const issues: readonly IssueSummary[] = [
    {
      sourceIdentity: "issue/7",
      url: `${base}/issues/7`,
      title: "Clarify setup",
      closed: true,
      linkedPullRequestIdentities: []
    }
  ];
  const contributors: readonly ContributorSummary[] = [
    { identity: "maintainer", url: "https://github.com/maintainer" }
  ];
  const priorReleases: readonly ReleaseSummary[] = [
    { tag: "v0.1.0", url: `${base}/releases/tag/v0.1.0`, title: "Initial release" }
  ];
  return { range, pullRequests, issues, contributors, priorReleases };
}

function draftValue(
  provider: AiProvider,
  request: DraftRequest
): StructuredReleaseDraft {
  const sourceIdentities = request.candidates
    .filter((candidate) => candidate.included)
    .sort((left, right) => left.order - right.order)
    .map((candidate) => candidate.sourceIdentity);
  return {
    content: {
      title: `Release with ${sourceIdentities.length} changes`,
      summary:
        sourceIdentities.length === 0
          ? "No included changes."
          : sourceIdentities.join(", ")
    },
    provenance: { provider, sourceIdentities, validation: "validated" }
  };
}

function createReader(seed: string, engine: MockEngine): GitHubReader {
  return {
    getRepository: async ({ operationId, repository }) =>
      engine.execute({
        provider: "github",
        operation: "repository.read",
        operationId,
        resourceId: repository.name,
        createValue: () => repositoryValue(seed, repository)
      }),
    compare: async ({ operationId, repository, range }) =>
      engine.execute({
        provider: "github",
        operation: "comparison.read",
        operationId,
        createValue: () => comparisonValue(repository, range)
      })
  };
}

function createPublisher(engine: MockEngine): GitHubPublisher {
  return {
    previewRelease: (request: ReleasePublicationRequest): ReleasePreview => ({
      ...request
    }),
    publishRelease: async (request: ConfirmedReleasePublication) =>
      engine.execute<PublishedRelease>({
        provider: "github",
        operation: "release.publish",
        operationId: request.operationId,
        resourceId: request.tag,
        createValue: () => ({
          tag: request.tag,
          url: `https://github.com/${request.repository.owner}/${request.repository.name}/releases/tag/${request.tag}`
        })
      })
  };
}

function createDrafter(provider: AiProvider, engine: MockEngine): ReleaseDrafter {
  return {
    draft: async (request) =>
      engine.execute({
        provider,
        operation: "draft.create",
        operationId: request.operationId,
        createValue: () => draftValue(provider, request)
      })
  };
}

function createReviewer(provider: AiProvider, engine: MockEngine) {
  return {
    review: async (
      request: DraftReviewRequest
    ): Promise<OperationResult<DraftReviewOutput>> =>
      engine.execute({
        provider,
        operation: "draft.review",
        operationId: request.operationId,
        createValue: () => ({
          kind: "review" as const,
          review: {
            provider,
            validation: request.draft.provenance.validation,
            citedSourceIdentities: request.draft.provenance.sourceIdentities,
            findings: []
          }
        })
      })
  };
}

function createBilling(engine: MockEngine): SponsorBilling {
  return {
    syncTier: async (input: { operationId: OperationId; tier: SponsorTier }) =>
      engine.execute({
        provider: "stripe",
        operation: "tier.sync",
        operationId: input.operationId,
        resourceId: input.tier.id,
        createValue: () => input.tier
      }),
    createCheckout: async (input) =>
      engine.execute<CheckoutSession>({
        provider: "stripe",
        operation: "checkout.create",
        operationId: input.operationId,
        resourceId: input.tierId,
        createValue: () => {
          const id = engine.id("checkout", input.operationId);
          return { id, url: `https://checkout.example.test/session/${id}` };
        }
      }),
    createPortal: async (input) =>
      engine.execute<PortalSession>({
        provider: "stripe",
        operation: "portal.create",
        operationId: input.operationId,
        resourceId: input.customerId,
        createValue: () => {
          const id = engine.id("portal", input.operationId);
          return { id, url: `https://billing.example.test/portal/${id}` };
        }
      })
  };
}

function createWebhookProjector(engine: MockEngine): StripeWebhookProjector {
  return {
    project: async (event: VerifiedWebhookEvent) =>
      engine.execute<MembershipProjection>({
        provider: "stripe",
        operation: "webhook.project",
        operationId: event.eventId,
        resourceId: event.customerId,
        createValue: () => ({
          customerId: event.customerId,
          state: event.membershipState,
          sourceEventId: event.eventId
        })
      })
  };
}

export function createMockRuntime(options: MockRuntimeOptions = {}): MockRuntime {
  const seed = options.seed ?? "release-relay-mock";
  const clock = new DeterministicClock(options.startAt ?? DEFAULT_START);
  const ledger = new MockLedger(() => clock.next());
  const engine = new MockEngine(seed, ledger, options.scriptedOutcomes ?? {});
  let operationSequence = 0;
  const reader = createReader(seed, engine);

  return {
    ledger,
    reader,
    publisher: createPublisher(engine),
    drafter: createDrafter(options.draftProvider ?? "openai", engine),
    reviewer: createReviewer(options.reviewProvider ?? "anthropic", engine),
    billing: createBilling(engine),
    webhookProjector: createWebhookProjector(engine),
    nextOperationId: (operation) =>
      stableId(seed, "operation", operation, String(operationSequence++)),
    assembleCandidates: async (input) => {
      const result = await reader.compare(input);
      if (result.status === "completed" || result.status === "duplicate") {
        return { ...result, value: assembleCandidates(result.value) };
      }
      return result;
    }
  };
}
