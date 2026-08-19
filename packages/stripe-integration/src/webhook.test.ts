import assert from "node:assert/strict";
import test from "node:test";
import { Stripe } from "stripe";
import {
  createStripeWebhookProjector,
  createStripeWebhookVerifier,
  mapSubscriptionStatus
} from "./webhook.js";

const webhookSecret = "whsec_test_fixture_secret";
const stripe = new Stripe("sk_test_fixture_key");

function subscriptionEventPayload(overrides: {
  id?: string;
  type?: string;
  created?: number;
  subscriptionId?: string;
  customerId?: string;
  status?: string;
}): string {
  const {
    id = "evt_1",
    type = "customer.subscription.updated",
    created = Math.floor(Date.now() / 1000),
    subscriptionId = "sub_1",
    customerId = "cus_1",
    status = "active"
  } = overrides;
  return JSON.stringify({
    id,
    object: "event",
    type,
    created,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: customerId,
        status
      }
    }
  });
}

function signedHeader(payload: string, timestamp?: number): string {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
    ...(timestamp === undefined ? {} : { timestamp })
  });
}

test("a validly signed subscription event is verified and mapped to a strict internal event", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({ status: "active", customerId: "cus_1" });
  const outcome = verifier.parse(payload, signedHeader(payload));
  assert.equal(outcome.kind, "verified");
  if (outcome.kind !== "verified") return;
  assert.equal(outcome.event.eventId, "evt_1");
  assert.equal(outcome.event.customerId, "cus_1");
  assert.equal(outcome.event.membershipState, "active");
  assert.equal(outcome.event.payloadHash.length, 64);
  assert.deepEqual(Object.keys(outcome.event).sort(), [
    "customerId",
    "eventCreatedAt",
    "eventId",
    "membershipState",
    "payloadHash"
  ]);
});

test("an invalid signature is rejected safely", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({});
  const wrongSecretHeader = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_wrong_secret"
  });
  assert.deepEqual(verifier.parse(payload, wrongSecretHeader), {
    kind: "invalid-signature"
  });
});

test("a missing signature header is rejected safely", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({});
  assert.deepEqual(verifier.parse(payload, ""), { kind: "invalid-signature" });
});

test("an expired signature timestamp is rejected safely", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({});
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 400;
  const header = signedHeader(payload, expiredTimestamp);
  assert.deepEqual(verifier.parse(payload, header), { kind: "invalid-signature" });
});

test("a tampered payload against a valid signature is rejected safely", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({ status: "active" });
  const header = signedHeader(payload);
  const tampered = subscriptionEventPayload({ status: "canceled" });
  assert.deepEqual(verifier.parse(tampered, header), { kind: "invalid-signature" });
});

test("an oversized payload is rejected before signature verification", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  let constructCalled = false;
  const original = stripe.webhooks.constructEvent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stripe.webhooks as any).constructEvent = () => {
    constructCalled = true;
    throw new Error("constructEvent should not be called for oversized payload");
  };
  try {
    const oversizedString = "a".repeat(1_000_001);
    assert.deepEqual(verifier.parse(oversizedString, "t=123,v1=abc"), {
      kind: "invalid-signature"
    });
    assert.equal(constructCalled, false);

    const oversizedBuffer = Buffer.alloc(1_000_001, 97);
    assert.deepEqual(verifier.parse(oversizedBuffer, "t=123,v1=abc"), {
      kind: "invalid-signature"
    });
    assert.equal(constructCalled, false);
  } finally {
    (stripe.webhooks as any).constructEvent = original;
  }
});

test("an undocumented event type is acknowledged as ignored without producing a verified event", () => {
  const verifier = createStripeWebhookVerifier(stripe, webhookSecret);
  const payload = subscriptionEventPayload({ type: "invoice.payment_succeeded" });
  const outcome = verifier.parse(payload, signedHeader(payload));
  assert.deepEqual(outcome, {
    kind: "ignored",
    eventId: "evt_1",
    eventType: "invoice.payment_succeeded"
  });
});

test("mapSubscriptionStatus collapses Stripe's status vocabulary without granting access on ambiguity", () => {
  assert.equal(mapSubscriptionStatus("active"), "active");
  assert.equal(mapSubscriptionStatus("trialing"), "active");
  assert.equal(mapSubscriptionStatus("past_due"), "past_due");
  assert.equal(mapSubscriptionStatus("unpaid"), "past_due");
  assert.equal(mapSubscriptionStatus("paused"), "past_due");
  assert.equal(mapSubscriptionStatus("canceled"), "canceled");
  assert.equal(mapSubscriptionStatus("incomplete_expired"), "canceled");
  assert.equal(mapSubscriptionStatus("incomplete"), "pending");
});

test("redelivering the identical verified event is idempotent", async () => {
  const projector = createStripeWebhookProjector();
  const event = {
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "active" as const,
    payloadHash: "hash_1"
  };
  const first = await projector.project(event);
  const second = await projector.project(event);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "duplicate");
  if (first.status !== "completed" || second.status !== "duplicate") return;
  assert.deepEqual(second.value, first.value);
});

test("the same event id with a different payload hash is refused as a conflict, not applied", async () => {
  const projector = createStripeWebhookProjector();
  await projector.project({
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "active",
    payloadHash: "hash_1"
  });
  const result = await projector.project({
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "canceled",
    payloadHash: "hash_2"
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "evt_1",
    errorClass: "conflict"
  });
});

test("an out-of-order older event never regresses a newer projection", async () => {
  const projector = createStripeWebhookProjector();
  await projector.project({
    eventId: "evt_2",
    eventCreatedAt: "2027-01-02T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "past_due",
    payloadHash: "hash_2"
  });
  const result = await projector.project({
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "active",
    payloadHash: "hash_1"
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.state, "past_due");
  assert.equal(result.value.sourceEventId, "evt_2");
});

test("projections are isolated per customer", async () => {
  const projector = createStripeWebhookProjector();
  const first = await projector.project({
    eventId: "evt_1",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_1",
    membershipState: "active",
    payloadHash: "hash_1"
  });
  const second = await projector.project({
    eventId: "evt_2",
    eventCreatedAt: "2027-01-01T00:00:00.000Z",
    customerId: "cus_2",
    membershipState: "past_due",
    payloadHash: "hash_2"
  });
  if (first.status !== "completed" || second.status !== "completed") {
    throw new Error("expected both events to complete");
  }
  assert.equal(first.value.customerId, "cus_1");
  assert.equal(second.value.customerId, "cus_2");
});
