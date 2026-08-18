import type { CandidateItem, DraftContent } from "./workspace.js";

export const providers = ["github", "openai", "anthropic", "stripe"] as const;

export type Provider = (typeof providers)[number];
export type AiProvider = Extract<Provider, "openai" | "anthropic">;
export type OperationId = string;

export const operationStatuses = [
  "completed",
  "duplicate",
  "refused",
  "failed"
] as const;

export type OperationStatus = (typeof operationStatuses)[number];

export type SafeErrorClass =
  | "authorization"
  | "conflict"
  | "invalid-input"
  | "not-found"
  | "rate-limit"
  | "unavailable"
  | "unknown";

export type OperationResult<T> =
  | { status: "completed"; operationId: OperationId; value: T }
  | { status: "duplicate"; operationId: OperationId; value: T }
  | { status: "refused"; operationId: OperationId; errorClass: SafeErrorClass }
  | { status: "failed"; operationId: OperationId; errorClass: SafeErrorClass };

export function operationStatus<T>(result: OperationResult<T>): OperationStatus {
  switch (result.status) {
    case "completed":
    case "duplicate":
    case "refused":
    case "failed":
      return result.status;
  }
}

export interface RepositoryRef {
  owner: string;
  name: string;
}

export interface ComparisonRange {
  base: string;
  head: string;
}

export interface RepositorySummary extends RepositoryRef {
  id: string;
  url: string;
}

export interface PullRequestSummary {
  sourceIdentity: string;
  url: string;
  title: string;
}

export interface IssueSummary {
  sourceIdentity: string;
  url: string;
  title: string;
}

export interface ContributorSummary {
  identity: string;
  url: string;
}

export interface ReleaseSummary {
  tag: string;
  url: string;
  title: string;
}

export interface ComparisonResult {
  range: ComparisonRange;
  pullRequests: readonly PullRequestSummary[];
  issues: readonly IssueSummary[];
  contributors: readonly ContributorSummary[];
  priorReleases: readonly ReleaseSummary[];
}

export interface GitHubReader {
  getRepository(repository: RepositoryRef): Promise<OperationResult<RepositorySummary>>;
  compare(input: {
    repository: RepositoryRef;
    range: ComparisonRange;
  }): Promise<OperationResult<ComparisonResult>>;
}

export interface ReleasePreview {
  workspaceId: string;
  repository: RepositoryRef;
  tag: string;
  title: string;
  body: string;
}

export interface ReleasePublicationRequest extends ReleasePreview {
  operationId: OperationId;
}

export interface ConfirmedReleasePublication extends ReleasePublicationRequest {
  confirmation: "confirmed";
}

export interface PublishedRelease {
  url: string;
  tag: string;
}

export interface GitHubPublisher {
  previewRelease(request: ReleasePublicationRequest): ReleasePreview;
  publishRelease(
    request: ConfirmedReleasePublication
  ): Promise<OperationResult<PublishedRelease>>;
}

export type DraftValidationState = "validated" | "validation-failed";

export interface DraftProvenance {
  provider: AiProvider;
  sourceIdentities: readonly string[];
  validation: DraftValidationState;
}

export interface StructuredReleaseDraft {
  content: DraftContent;
  provenance: DraftProvenance;
}

export interface DraftRequest {
  operationId: OperationId;
  candidates: readonly CandidateItem[];
}

export interface ReleaseDrafter {
  draft(request: DraftRequest): Promise<OperationResult<StructuredReleaseDraft>>;
}

export interface DraftFinding {
  code: string;
  sourceIdentity?: string;
}

export interface DraftReview {
  provider: AiProvider;
  validation: DraftValidationState;
  citedSourceIdentities: readonly string[];
  findings: readonly DraftFinding[];
}

export type DraftReviewOutput =
  | { kind: "review"; review: DraftReview }
  | { kind: "alternate-draft"; draft: StructuredReleaseDraft };

export interface DraftReviewRequest {
  operationId: OperationId;
  draft: StructuredReleaseDraft;
}

export interface DraftReviewer {
  review(request: DraftReviewRequest): Promise<OperationResult<DraftReviewOutput>>;
}

export const membershipStates = [
  "pending",
  "active",
  "past_due",
  "canceled",
  "unknown"
] as const;

export type MembershipState = (typeof membershipStates)[number];

export interface SponsorTier {
  id: string;
  name: string;
  description: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface PortalSession {
  id: string;
  url: string;
}

export interface SponsorBilling {
  syncTier(input: {
    operationId: OperationId;
    tier: SponsorTier;
  }): Promise<OperationResult<SponsorTier>>;
  createCheckout(input: {
    operationId: OperationId;
    tierId: string;
    customerId?: string;
  }): Promise<OperationResult<CheckoutSession>>;
  createPortal(input: {
    operationId: OperationId;
    customerId: string;
  }): Promise<OperationResult<PortalSession>>;
}

export interface VerifiedWebhookEvent {
  eventId: string;
  customerId: string;
  membershipState: MembershipState;
}

export interface MembershipProjection {
  customerId: string;
  state: MembershipState;
  sourceEventId: string;
}

export interface StripeWebhookProjector {
  project(event: VerifiedWebhookEvent): Promise<OperationResult<MembershipProjection>>;
}

export type OperationLedgerEntry =
  | {
      operationId: OperationId;
      provider: Provider;
      operation: string;
      status: "completed" | "duplicate";
      resourceId?: string;
    }
  | {
      operationId: OperationId;
      provider: Provider;
      operation: string;
      status: "refused" | "failed";
      errorClass: SafeErrorClass;
    };

export interface OperationLedger {
  record(entry: OperationLedgerEntry): void;
  entries(): readonly OperationLedgerEntry[];
}
