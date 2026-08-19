import { createHash } from "node:crypto";
import { assembleCandidates } from "@release-relay/github-integration";
import {
  citedDraftSourceIdentities,
  projectMembership,
  releasePreviewHash,
  validateReleaseDraft
} from "@release-relay/core";
import type {
  AiProvider,
  CandidateItem,
  ComparisonRange,
  ComparisonResult,
  ConfirmedReleasePublication,
  ContributorSummary,
  DraftGeneration,
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
  ReleaseAuthorization,
  ReleaseConfirmation,
  ReleaseDrafter,
  ReleasePublicationRequest,
  ReleasePreview,
  ReleaseSummary,
  RepositoryRef,
  RepositorySummary,
  SafeErrorClass,
  SponsorBilling,
  SponsorTier,
  StructuredReleaseDraft,
  SyncedSponsorTier,
  StripeWebhookProjector,
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
  fingerprint?: string;
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
    fingerprint?: string;
    resourceId?: string;
    createValue: () => T;
  }): OperationResult<T> {
    const previous = this.completed.get(input.operationId);
    if (previous !== undefined) {
      if (
        previous.provider !== input.provider ||
        previous.operation !== input.operation ||
        previous.fingerprint !== input.fingerprint
      ) {
        const result: OperationResult<T> = {
          status: "refused",
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
      ...(input.fingerprint === undefined ? {} : { fingerprint: input.fingerprint }),
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

  now(): Date {
    return new Date(this.startAt + this.tick * 1000);
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
  request: DraftRequest,
  seed: string,
  clock: DeterministicClock
): StructuredReleaseDraft {
  const included = request.candidates
    .filter((candidate) => candidate.included)
    .sort((left, right) => left.order - right.order);
  return {
    body: {
      title:
        included.length === 0
          ? "Release"
          : `Release with ${included.length} change${included.length === 1 ? "" : "s"}`,
      summary:
        included.length === 0
          ? "No included changes."
          : `Includes ${included.length} merged change${included.length === 1 ? "" : "s"}.`,
      changeGroups:
        included.length === 0
          ? []
          : [
              {
                kind: "changed" as const,
                heading: "Changed",
                items: included.map((candidate) => ({
                  summary: candidate.title,
                  sourceIdentities: [candidate.sourceIdentity]
                }))
              }
            ],
      acknowledgements: []
    },
    provenance: {
      provider,
      model: `mock-${provider}-draft`,
      configurationId: stableId(seed, "draft-configuration", provider),
      generatedAt: clock.next(),
      timeSource: "operation-clock"
    }
  };
}

function draftGeneration(
  provider: AiProvider,
  request: DraftRequest,
  seed: string,
  clock: DeterministicClock
): DraftGeneration {
  const outcome = validateReleaseDraft(
    request.candidates,
    draftValue(provider, request, seed, clock)
  );
  if (outcome.ok) {
    return { kind: "validated-draft", draft: outcome.draft };
  }
  return { kind: outcome.reason, findings: outcome.findings };
}

function releasePreviewFields(
  preview: ReleasePreview
): Omit<ReleasePreview, "previewHash"> {
  return {
    operationId: preview.operationId,
    workspaceId: preview.workspaceId,
    repository: preview.repository,
    authorizationRevision: preview.authorizationRevision,
    tag: preview.tag,
    title: preview.title,
    body: preview.body,
    draft: preview.draft,
    prerelease: preview.prerelease,
    expiresAt: preview.expiresAt
  };
}

function cloneReleaseConfirmation(
  confirmation: ReleaseConfirmation
): ReleaseConfirmation {
  return { ...confirmation };
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

function createPublisher(
  seed: string,
  engine: MockEngine,
  clock: DeterministicClock
): GitHubPublisher {
  const previews = new Map<string, ReleasePreview>();
  const operationPreviews = new Map<string, string>();
  const confirmations = new Map<string, ReleaseConfirmation>();
  const completedPublications = new Map<
    string,
    { previewHash: string; value: PublishedRelease }
  >();

  return {
    getAuthorization: async ({ operationId, repository }) =>
      engine.execute<ReleaseAuthorization>({
        provider: "github",
        operation: "release.authorization",
        operationId,
        resourceId: repository.name,
        createValue: () => ({
          repository,
          revision: stableId(seed, "authorization", repository.owner, repository.name),
          canPublish: true
        })
      }),
    previewRelease: (request: ReleasePublicationRequest): ReleasePreview => {
      const fields = {
        operationId: request.operationId,
        workspaceId: request.workspaceId,
        repository: { ...request.repository },
        authorizationRevision: request.authorizationRevision,
        tag: request.tag,
        title: request.title,
        body: request.body,
        draft: request.draft ?? false,
        prerelease: request.prerelease ?? false,
        expiresAt: new Date(clock.now().getTime() + 5 * 60 * 1000).toISOString()
      };
      const preview = { ...fields, previewHash: releasePreviewHash(fields) };
      const previousHash = operationPreviews.get(preview.operationId);
      if (previousHash !== undefined && previousHash !== preview.previewHash) {
        throw new Error("operation ID already binds a different preview");
      }
      operationPreviews.set(preview.operationId, preview.previewHash);
      previews.set(preview.previewHash, {
        ...preview,
        repository: { ...preview.repository }
      });
      return { ...preview, repository: { ...preview.repository } };
    },
    confirmRelease: ({ preview, authorizationRevision }) => {
      const fields = releasePreviewFields(preview);
      const issued = previews.get(preview.previewHash);
      if (
        issued === undefined ||
        JSON.stringify(releasePreviewFields(issued)) !== JSON.stringify(fields) ||
        releasePreviewHash(fields) !== preview.previewHash
      ) {
        return {
          status: "failed",
          operationId: preview.operationId,
          errorClass: "invalid-input"
        };
      }
      if (clock.now().getTime() >= Date.parse(preview.expiresAt)) {
        return {
          status: "failed",
          operationId: preview.operationId,
          errorClass: "invalid-input"
        };
      }
      if (authorizationRevision !== preview.authorizationRevision) {
        return {
          status: "refused",
          operationId: preview.operationId,
          errorClass: "authorization"
        };
      }
      const confirmation = {
        token: stableId(seed, "confirmation", preview.previewHash),
        previewHash: preview.previewHash,
        authorizationRevision: preview.authorizationRevision,
        expiresAt: preview.expiresAt
      };
      confirmations.set(confirmation.token, cloneReleaseConfirmation(confirmation));
      return {
        status: "completed",
        operationId: preview.operationId,
        value: cloneReleaseConfirmation(confirmation)
      };
    },
    publishRelease: async (request: ConfirmedReleasePublication) => {
      const fields = releasePreviewFields(request);
      const issued = previews.get(request.previewHash);
      const storedConfirmation = confirmations.get(request.confirmation.token);
      if (
        issued === undefined ||
        JSON.stringify(releasePreviewFields(issued)) !== JSON.stringify(fields) ||
        releasePreviewHash(fields) !== request.previewHash ||
        storedConfirmation === undefined ||
        storedConfirmation.previewHash !== request.confirmation.previewHash ||
        storedConfirmation.authorizationRevision !==
          request.confirmation.authorizationRevision ||
        storedConfirmation.expiresAt !== request.confirmation.expiresAt ||
        request.confirmation.previewHash !== request.previewHash ||
        request.confirmation.authorizationRevision !== request.authorizationRevision ||
        request.confirmation.expiresAt !== request.expiresAt
      ) {
        return {
          status: "failed",
          operationId: request.operationId,
          errorClass: "invalid-input"
        };
      }
      if (
        request.authorizationRevision !==
        stableId(
          seed,
          "authorization",
          request.repository.owner,
          request.repository.name
        )
      ) {
        return {
          status: "refused",
          operationId: request.operationId,
          errorClass: "authorization"
        };
      }
      const previous = completedPublications.get(request.operationId);
      if (previous !== undefined) {
        if (previous.previewHash !== request.previewHash) {
          return {
            status: "refused",
            operationId: request.operationId,
            errorClass: "conflict"
          };
        }
        return {
          status: "duplicate",
          operationId: request.operationId,
          value: previous.value
        };
      }
      if (clock.now().getTime() >= Date.parse(request.expiresAt)) {
        return {
          status: "failed",
          operationId: request.operationId,
          errorClass: "invalid-input"
        };
      }
      const result = await engine.execute<PublishedRelease>({
        provider: "github",
        operation: "release.publish",
        operationId: request.operationId,
        fingerprint: request.previewHash,
        resourceId: request.tag,
        createValue: () => ({
          tag: request.tag,
          url: `https://github.com/${request.repository.owner}/${request.repository.name}/releases/tag/${request.tag}`
        })
      });
      if (result.status === "completed" || result.status === "duplicate") {
        completedPublications.set(request.operationId, {
          previewHash: request.previewHash,
          value: result.value
        });
      }
      return result;
    }
  };
}

function createDrafter(
  provider: AiProvider,
  engine: MockEngine,
  seed: string,
  clock: DeterministicClock
): ReleaseDrafter {
  return {
    draft: async (request) =>
      engine.execute({
        provider,
        operation: "draft.create",
        operationId: request.operationId,
        createValue: () => draftGeneration(provider, request, seed, clock)
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
            validation: "validated" as const,
            citedSourceIdentities: citedDraftSourceIdentities(request.draft),
            findings: []
          }
        })
      })
  };
}

function createBilling(engine: MockEngine): SponsorBilling {
  return {
    syncTier: async (input: { operationId: OperationId; tier: SponsorTier }) =>
      engine.execute<SyncedSponsorTier>({
        provider: "stripe",
        operation: "tier.sync",
        operationId: input.operationId,
        resourceId: input.tier.id,
        createValue: () => ({
          ...input.tier,
          providerProductId: engine.id("product", input.operationId),
          providerPriceId: engine.id("price", input.operationId)
        })
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
  // A redelivered event id with a changed payload hash is refused before it
  // ever reaches the ledger — mirrors createPublisher's previewHash guard,
  // not the engine's own generic (and differently-classified) conflict path.
  const seenPayloadHashes = new Map<string, string>();
  const projections = new Map<string, MembershipProjection>();

  return {
    project: async (event: VerifiedWebhookEvent) => {
      const priorHash = seenPayloadHashes.get(event.eventId);
      if (priorHash !== undefined && priorHash !== event.payloadHash) {
        return {
          status: "refused" as const,
          operationId: event.eventId,
          errorClass: "conflict" as const
        };
      }
      seenPayloadHashes.set(event.eventId, event.payloadHash);
      return engine.execute<MembershipProjection>({
        provider: "stripe",
        operation: "webhook.project",
        operationId: event.eventId,
        resourceId: event.customerId,
        createValue: () => {
          const current = projections.get(event.customerId);
          const outcome = projectMembership(current, event);
          projections.set(event.customerId, outcome.projection);
          return outcome.projection;
        }
      });
    }
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
    publisher: createPublisher(seed, engine, clock),
    drafter: createDrafter(options.draftProvider ?? "openai", engine, seed, clock),
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
