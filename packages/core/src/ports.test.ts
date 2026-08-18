import assert from "node:assert/strict";
import test from "node:test";
import { operationStatus, type OperationResult, type SponsorBilling } from "./ports.js";

test("operation results expose every safe outcome", () => {
  const results: readonly OperationResult<string>[] = [
    { status: "completed", operationId: "op-1", value: "created" },
    { status: "duplicate", operationId: "op-2", value: "existing" },
    { status: "refused", operationId: "op-3", errorClass: "authorization" },
    { status: "failed", operationId: "op-4", errorClass: "unavailable" }
  ];

  assert.deepEqual(results.map(operationStatus), [
    "completed",
    "duplicate",
    "refused",
    "failed"
  ]);
  for (const result of results) {
    assert.equal("error" in result, false);
    assert.equal("request" in result, false);
    assert.equal("payload" in result, false);
  }
});

test("billing sessions cannot claim membership state", () => {
  type BillingResults = Awaited<ReturnType<SponsorBilling["createCheckout"]>>;
  type CheckoutValue = Extract<BillingResults, { status: "completed" }>["value"];

  const session: CheckoutValue = {
    id: "checkout-1",
    url: "https://checkout.example.test"
  };
  assert.equal("state" in session, false);
  assert.equal("membershipState" in session, false);
});
