import { createHash } from "node:crypto";
import { Stripe } from "stripe";
import type {
  MembershipProjection,
  MembershipState,
  OperationResult,
  StripeWebhookProjector,
  VerifiedWebhookEvent
} from "@release-relay/core";
import { projectMembership } from "@release-relay/core";

const MAX_WEBHOOK_BYTES = 1_000_000;

// Only subscription-lifecycle events drive membership state. Anything else
// (invoices, charges, disputes, ...) is acknowledged and ignored without
// ever reaching projection — an explicit allow list, not a deny list.
const permittedEventTypes = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted"
] as const;

type PermittedEventType = (typeof permittedEventTypes)[number];

function isPermittedEventType(type: string): type is PermittedEventType {
  return (permittedEventTypes as readonly string[]).includes(type);
}

// Stripe's subscription vocabulary collapsed into Release Relay's smaller
// membership states. Trialing counts as active access; incomplete and paused
// fail closed to pending/past_due rather than granting access outright.
export function mapSubscriptionStatus(
  status: Stripe.Subscription["status"]
): MembershipState {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
      return "pending";
    default:
      return "unknown";
  }
}

export type WebhookParseOutcome =
  | { kind: "verified"; event: VerifiedWebhookEvent }
  | { kind: "ignored"; eventId: string; eventType: string }
  | { kind: "invalid-signature" };

export interface StripeWebhookVerifier {
  parse(rawBody: string | Buffer, signatureHeader: string): WebhookParseOutcome;
}

export function createStripeWebhookVerifier(
  stripe: Stripe,
  webhookSecret: string
): StripeWebhookVerifier {
  if (webhookSecret.trim() === "") throw new Error("webhookSecret is required");
  return {
    parse(rawBody, signatureHeader) {
      const byteLength =
        typeof rawBody === "string"
          ? Buffer.byteLength(rawBody, "utf8")
          : rawBody.length;
      if (byteLength > MAX_WEBHOOK_BYTES) {
        return { kind: "invalid-signature" };
      }
      let event: Stripe.Event;
      try {
        // webhook-verify-client
        // constructEvent verifies the signature (and default 5-minute
        // timestamp tolerance) against the raw bytes before JSON parsing —
        // an invalid, missing, expired, or mismatched signature throws here,
        // so domain mapping never sees an unverified payload.
        event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
      } catch {
        return { kind: "invalid-signature" };
      }
      if (!isPermittedEventType(event.type)) {
        return { kind: "ignored", eventId: event.id, eventType: event.type };
      }
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      return {
        kind: "verified",
        event: {
          eventId: event.id,
          eventCreatedAt: new Date(event.created * 1000).toISOString(),
          customerId,
          membershipState: mapSubscriptionStatus(subscription.status),
          payloadHash: createHash("sha256").update(rawBody).digest("hex")
        }
      };
    }
  };
}

// Per-eventId payload-hash tracking guards against a redelivered event id
// whose bytes changed; per-customer projections give projectMembership the
// right "current" state to compare newest-wins ordering against.
export function createStripeWebhookProjector(): StripeWebhookProjector {
  const seenEvents = new Map<
    string,
    { payloadHash: string; projection: MembershipProjection }
  >();
  const projections = new Map<string, MembershipProjection>();

  return {
    project: async (
      event: VerifiedWebhookEvent
    ): Promise<OperationResult<MembershipProjection>> => {
      const stored = seenEvents.get(event.eventId);
      if (stored !== undefined) {
        return stored.payloadHash === event.payloadHash
          ? {
              status: "duplicate",
              operationId: event.eventId,
              value: stored.projection
            }
          : { status: "refused", operationId: event.eventId, errorClass: "conflict" };
      }
      const current = projections.get(event.customerId);
      const outcome = projectMembership(current, event);
      projections.set(event.customerId, outcome.projection);
      seenEvents.set(event.eventId, {
        payloadHash: event.payloadHash,
        projection: outcome.projection
      });
      return {
        status: "completed",
        operationId: event.eventId,
        value: outcome.projection
      };
    }
  };
}
