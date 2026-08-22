import type {
  Currency,
  MembershipProjection,
  MembershipState,
  Money,
  VerifiedWebhookEvent
} from "./ports.js";
import { membershipStates, supportedCurrencies } from "./ports.js";

export type MoneyValidationOutcome =
  | { ok: true; money: Money }
  | { ok: false; reason: "non-integer" | "negative" | "unsupported-currency" };

// Guards against the usual accidental-conversion bugs: a float slipping in
// from a major-unit amount (or a floating-point `dollars * 100`), a negative
// amount, and a currency shape Stripe wasn't configured for.
export function createMoney(
  minorUnits: unknown,
  currency: unknown
): MoneyValidationOutcome {
  if (typeof minorUnits !== "number" || !Number.isInteger(minorUnits)) {
    return { ok: false, reason: "non-integer" };
  }
  if (minorUnits < 0) {
    return { ok: false, reason: "negative" };
  }
  const normalizedCurrency =
    typeof currency === "string" ? currency.toLowerCase() : currency;
  if (
    typeof normalizedCurrency !== "string" ||
    !(supportedCurrencies as readonly string[]).includes(normalizedCurrency as string)
  ) {
    return { ok: false, reason: "unsupported-currency" };
  }
  return { ok: true, money: { minorUnits, currency: normalizedCurrency as Currency } };
}

// Unrecognized or non-string input must fall back to "unknown" rather than
// have a caller guess at active/canceled from incomplete data.
export function parseMembershipState(value: unknown): MembershipState {
  return typeof value === "string" &&
    (membershipStates as readonly string[]).includes(value)
    ? (value as MembershipState)
    : "unknown";
}

export type MembershipTransitionOutcome =
  | { kind: "applied"; projection: MembershipProjection }
  | { kind: "duplicate"; projection: MembershipProjection }
  | { kind: "stale"; projection: MembershipProjection };

// Pure reducer shared by every webhook boundary: an exact-duplicate delivery
// (same event id) and an event strictly older than the current projection both
// leave state untouched, so replayed or out-of-order delivery can never regress
// a newer authoritative state. Stripe's event.created carries whole-second
// precision, so distinct events created within the same wall-clock second tie
// on timestamp; those ties resolve by delivery order — each distinct event
// applies in the order it arrives, even when its created second matches the
// current projection's — while identical-id redelivery remains a duplicate
// no-op.
export function projectMembership(
  current: MembershipProjection | undefined,
  event: VerifiedWebhookEvent
): MembershipTransitionOutcome {
  if (current !== undefined && current.sourceEventId === event.eventId) {
    return { kind: "duplicate", projection: current };
  }
  if (
    current !== undefined &&
    Date.parse(event.eventCreatedAt) < Date.parse(current.sourceEventCreatedAt)
  ) {
    return { kind: "stale", projection: current };
  }
  return {
    kind: "applied",
    projection: {
      customerId: event.customerId,
      state: event.membershipState,
      sourceEventId: event.eventId,
      sourceEventCreatedAt: event.eventCreatedAt
    }
  };
}
