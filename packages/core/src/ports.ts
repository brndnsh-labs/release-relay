import { createHash } from "node:crypto";
import type { DraftFinding, DraftGeneration, StructuredReleaseDraft } from "./draft.js";
import type { CandidateItem } from "./workspace.js";

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
  merged: boolean;
  reverted: boolean;
  linkedIssueIdentities: readonly string[];
  included?: boolean;
  maintainerAnnotation?: string;
}

export interface IssueSummary {
  sourceIdentity: string;
  url: string;
  title: string;
  closed: boolean;
  linkedPullRequestIdentities: readonly string[];
  included?: boolean;
  maintainerAnnotation?: string;
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
  getRepository(input: {
    operationId: OperationId;
    repository: RepositoryRef;
  }): Promise<OperationResult<RepositorySummary>>;
  compare(input: {
    operationId: OperationId;
    repository: RepositoryRef;
    range: ComparisonRange;
  }): Promise<OperationResult<ComparisonResult>>;
}

export interface ReleasePreview {
  operationId: OperationId;
  workspaceId: string;
  repository: RepositoryRef;
  authorizationRevision: string;
  tag: string;
  title: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  expiresAt: string;
  previewHash: string;
}

export interface ReleasePublicationRequest {
  operationId: OperationId;
  workspaceId: string;
  repository: RepositoryRef;
  authorizationRevision: string;
  tag: string;
  title: string;
  body: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ReleaseAuthorization {
  repository: RepositoryRef;
  revision: string;
  canPublish: boolean;
}

export interface ReleaseConfirmation {
  token: string;
  previewHash: string;
  authorizationRevision: string;
  expiresAt: string;
}

export interface ReleaseConfirmationInput {
  preview: ReleasePreview;
  authorizationRevision: string;
}

export interface ConfirmedReleasePublication extends ReleasePreview {
  confirmation: ReleaseConfirmation;
}

export function releasePreviewHash(
  preview: Omit<ReleasePreview, "previewHash">
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
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
      })
    )
    .digest("hex");
}

export interface PublishedRelease {
  url: string;
  tag: string;
}

export interface GitHubPublisher {
  getAuthorization(input: {
    operationId: OperationId;
    repository: RepositoryRef;
  }): Promise<OperationResult<ReleaseAuthorization>>;
  previewRelease(request: ReleasePublicationRequest): ReleasePreview;
  confirmRelease(input: ReleaseConfirmationInput): OperationResult<ReleaseConfirmation>;
  publishRelease(
    request: ConfirmedReleasePublication
  ): Promise<OperationResult<PublishedRelease>>;
}

export type DraftValidationState = "validated" | "validation-failed";

export interface DraftRequest {
  operationId: OperationId;
  candidates: readonly CandidateItem[];
}

export interface ReleaseDrafter {
  draft(request: DraftRequest): Promise<OperationResult<DraftGeneration>>;
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

export const supportedCurrencies = ["usd", "eur", "gbp"] as const;

export type Currency = (typeof supportedCurrencies)[number];

// Integer minor units plus an explicit currency, never a float major-unit
// amount — see billing.ts's createMoney for the smart constructor.
export interface Money {
  minorUnits: number;
  currency: Currency;
}

export interface SponsorTier {
  id: string;
  name: string;
  description: string;
  price: Money;
}

// The maintainer-configured tier, reconciled with the Stripe product/price
// that syncTier actually created or reused. Keeping this distinct from
// SponsorTier stops a merely-configured tier from being mistaken for one a
// provider call has confirmed.
export interface SyncedSponsorTier extends SponsorTier {
  providerProductId: string;
  providerPriceId: string;
}

// Browser-hosted session references only — deliberately no membership state
// field. A redirect back from Checkout or the portal cannot by itself prove
// billing succeeded; only projectMembership(VerifiedWebhookEvent) in
// billing.ts may produce a MembershipProjection.
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
  }): Promise<OperationResult<SyncedSponsorTier>>;
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
  eventCreatedAt: string;
  customerId: string;
  membershipState: MembershipState;
}

export interface MembershipProjection {
  customerId: string;
  state: MembershipState;
  sourceEventId: string;
  sourceEventCreatedAt: string;
}

export interface StripeWebhookProjector {
  project(event: VerifiedWebhookEvent): Promise<OperationResult<MembershipProjection>>;
}

export type OperationLedgerEntryInput =
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

export type OperationLedgerEntry = OperationLedgerEntryInput & {
  recordedAt: string;
};

export interface OperationLedger {
  record(entry: OperationLedgerEntryInput): void;
  entries(): readonly OperationLedgerEntry[];
}
