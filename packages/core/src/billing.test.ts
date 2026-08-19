import assert from "node:assert/strict";
import test from "node:test";
import type { MembershipProjection, VerifiedWebhookEvent } from "./ports.js";
import { createMoney, parseMembershipState, projectMembership } from "./billing.js";

test("createMoney accepts an integer minor-unit amount with a supported currency", () => {
  const result = createMoney(1999, "usd");
  assert.deepEqual(result, { ok: true, money: { minorUnits: 1999, currency: "usd" } });
});

test("createMoney normalizes currency casing", () => {
  const result = createMoney(500, "USD");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.money.currency, "usd");
});

test("createMoney rejects a float, the usual accidental-conversion bug", () => {
  const result = createMoney(19.99, "usd");
  assert.deepEqual(result, { ok: false, reason: "non-integer" });
});

test("createMoney rejects a floating-point drift amount", () => {
  const result = createMoney(19.99 * 100 - 1999, "usd");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "non-integer");
});

test("createMoney rejects a negative amount", () => {
  const result = createMoney(-500, "usd");
  assert.deepEqual(result, { ok: false, reason: "negative" });
});

test("createMoney rejects an unsupported currency", () => {
  const result = createMoney(500, "xyz");
  assert.deepEqual(result, { ok: false, reason: "unsupported-currency" });
});

test("createMoney rejects a non-numeric or non-string input shape", () => {
  assert.deepEqual(createMoney("500", "usd"), { ok: false, reason: "non-integer" });
  assert.deepEqual(createMoney(500, 840), {
    ok: false,
    reason: "unsupported-currency"
  });
});

test("parseMembershipState passes through a recognized state", () => {
  assert.equal(parseMembershipState("active"), "active");
  assert.equal(parseMembershipState("past_due"), "past_due");
});

test("parseMembershipState falls back to unknown for unrecognized or incomplete input", () => {
  assert.equal(parseMembershipState("trialing"), "unknown");
  assert.equal(parseMembershipState(undefined), "unknown");
  assert.equal(parseMembershipState(null), "unknown");
  assert.equal(parseMembershipState(""), "unknown");
});

function event(overrides: Partial<VerifiedWebhookEvent> = {}): VerifiedWebhookEvent {
  return {
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "active",
    payloadHash: "hash_1",
    ...overrides
  };
}

test("projectMembership applies the first event for a customer", () => {
  const outcome = projectMembership(undefined, event());
  assert.deepEqual(outcome, {
    kind: "applied",
    projection: {
      customerId: "cus_1",
      state: "active",
      sourceEventId: "evt_1",
      sourceEventCreatedAt: "2027-01-01T00:00:00.000Z"
    }
  });
});

test("projectMembership applies a newer event and preserves its identity and ordering metadata", () => {
  const current: MembershipProjection = {
    customerId: "cus_1",
    state: "active",
    sourceEventId: "evt_1",
    sourceEventCreatedAt: "2027-01-01T00:00:00.000Z"
  };
  const outcome = projectMembership(
    current,
    event({
      eventId: "evt_2",
      eventCreatedAt: "2027-01-02T00:00:00.000Z",
      membershipState: "past_due"
    })
  );
  assert.deepEqual(outcome, {
    kind: "applied",
    projection: {
      customerId: "cus_1",
      state: "past_due",
      sourceEventId: "evt_2",
      sourceEventCreatedAt: "2027-01-02T00:00:00.000Z"
    }
  });
});

test("projectMembership treats an exact-duplicate event id as a no-op", () => {
  const current: MembershipProjection = {
    customerId: "cus_1",
    state: "active",
    sourceEventId: "evt_1",
    sourceEventCreatedAt: "2027-01-01T00:00:00.000Z"
  };
  const outcome = projectMembership(current, event({ membershipState: "canceled" }));
  assert.equal(outcome.kind, "duplicate");
  assert.deepEqual(outcome.projection, current);
});

test("projectMembership preserves the newest authoritative state against a stale, out-of-order event", () => {
  const current: MembershipProjection = {
    customerId: "cus_1",
    state: "active",
    sourceEventId: "evt_2",
    sourceEventCreatedAt: "2027-01-02T00:00:00.000Z"
  };
  const outcome = projectMembership(
    current,
    event({
      eventId: "evt_1",
      eventCreatedAt: "2027-01-01T00:00:00.000Z",
      membershipState: "canceled"
    })
  );
  assert.equal(outcome.kind, "stale");
  assert.deepEqual(outcome.projection, current);
});

test("projectMembership carries an unknown state through rather than inventing an optimistic one", () => {
  const outcome = projectMembership(
    undefined,
    event({ membershipState: parseMembershipState("some_future_status") })
  );
  assert.equal(outcome.kind, "applied");
  assert.equal(outcome.projection.state, "unknown");
});
