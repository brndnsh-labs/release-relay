import assert from "node:assert/strict";
import test from "node:test";
import type { SponsorTier } from "@release-relay/core";
import { Stripe } from "stripe";
import {
  createStripeBilling,
  createStripeBillingFromClient,
  type StripeBillingApi,
  type StripeCheckoutSessionRecord,
  type StripePortalSessionRecord,
  type StripePriceRecord,
  type StripeProductRecord
} from "./billing.js";

const scope = {
  successUrl: "https://relay.example.test/checkout/success",
  cancelUrl: "https://relay.example.test/checkout/cancel",
  portalReturnUrl: "https://relay.example.test/account"
};

function tier(overrides: Partial<SponsorTier> = {}): SponsorTier {
  return {
    id: "supporter",
    name: "Supporter",
    description: "Thank you",
    price: { minorUnits: 500, currency: "usd" },
    ...overrides
  };
}

interface FakeState {
  products: StripeProductRecord[];
  prices: StripePriceRecord[];
  createProductCalls: number;
  createPriceCalls: number;
  createCheckoutCalls: number;
  createPortalCalls: number;
  lastCheckoutParams?: Parameters<StripeBillingApi["createCheckoutSession"]>[0];
  lastPortalParams?: Parameters<StripeBillingApi["createPortalSession"]>[0];
  lastIdempotencyKeys: string[];
}

function fakeApi(overrides: Partial<StripeBillingApi> = {}): {
  api: StripeBillingApi;
  state: FakeState;
} {
  const state: FakeState = {
    products: [],
    prices: [],
    createProductCalls: 0,
    createPriceCalls: 0,
    createCheckoutCalls: 0,
    createPortalCalls: 0,
    lastIdempotencyKeys: []
  };
  let productSeq = 0;
  let priceSeq = 0;
  const api: StripeBillingApi = {
    listProducts: async () => state.products,
    createProduct: async (params, options) => {
      state.createProductCalls++;
      state.lastIdempotencyKeys.push(options.idempotencyKey);
      const record: StripeProductRecord = {
        id: `prod_${++productSeq}`,
        metadata: params.metadata
      };
      state.products.push(record);
      return record;
    },
    listPrices: async () => state.prices,
    createPrice: async (params, options) => {
      state.createPriceCalls++;
      state.lastIdempotencyKeys.push(options.idempotencyKey);
      const record: StripePriceRecord = {
        id: `price_${++priceSeq}`,
        unitAmount: params.unitAmount,
        currency: params.currency,
        active: true
      };
      state.prices.push(record);
      return record;
    },
    createCheckoutSession: async (params, options) => {
      state.createCheckoutCalls++;
      state.lastCheckoutParams = params;
      state.lastIdempotencyKeys.push(options.idempotencyKey);
      const record: StripeCheckoutSessionRecord = {
        id: "cs_1",
        url: "https://checkout.stripe.example.test/cs_1"
      };
      return record;
    },
    createPortalSession: async (params, options) => {
      state.createPortalCalls++;
      state.lastPortalParams = params;
      state.lastIdempotencyKeys.push(options.idempotencyKey);
      const record: StripePortalSessionRecord = {
        id: "bps_1",
        url: "https://billing.stripe.example.test/bps_1"
      };
      return record;
    },
    ...overrides
  };
  return { api, state };
}

test("syncTier creates a product and price when none exist yet", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.providerProductId, "prod_1");
  assert.equal(result.value.providerPriceId, "price_1");
  assert.equal(state.createProductCalls, 1);
  assert.equal(state.createPriceCalls, 1);
  assert.deepEqual(state.lastIdempotencyKeys, [
    "product:supporter",
    "price:prod_1:500:usd"
  ]);
});

test("syncTier reuses a matching product and price instead of creating duplicates", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  await billing.syncTier({ operationId: "sync-1", tier: tier() });
  const result = await billing.syncTier({ operationId: "sync-2", tier: tier() });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.providerProductId, "prod_1");
  assert.equal(result.value.providerPriceId, "price_1");
  assert.equal(state.createProductCalls, 1);
  assert.equal(state.createPriceCalls, 1);
});

test("a changed tier price creates a new price and never mutates the existing active one", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  await billing.syncTier({ operationId: "sync-1", tier: tier() });
  const changed = tier({ price: { minorUnits: 900, currency: "usd" } });
  const result = await billing.syncTier({ operationId: "sync-2", tier: changed });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.value.providerProductId, "prod_1");
  assert.equal(result.value.providerPriceId, "price_2");
  assert.equal(state.createProductCalls, 1);
  assert.equal(state.createPriceCalls, 2);
  const original = state.prices.find((price) => price.id === "price_1");
  assert.deepEqual(original, {
    id: "price_1",
    unitAmount: 500,
    currency: "usd",
    active: true
  });
});

test("reusing an operation ID returns the stored value without a second provider call", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const first = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  const second = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.equal(first.status, "completed");
  assert.equal(second.status, "duplicate");
  if (first.status !== "completed" || second.status !== "duplicate") return;
  assert.deepEqual(second.value, first.value);
  assert.equal(state.createProductCalls, 1);
  assert.equal(state.createPriceCalls, 1);
});

test("createCheckout resolves the synced tier's price and returns only a session id and url", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  await billing.syncTier({ operationId: "sync-1", tier: tier() });
  const result = await billing.createCheckout({
    operationId: "checkout-1",
    tierId: "supporter",
    customerId: "cus_1"
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, {
    id: "cs_1",
    url: "https://checkout.stripe.example.test/cs_1"
  });
  assert.equal("state" in result.value, false);
  assert.equal(state.lastCheckoutParams?.price, "price_1");
  assert.equal(state.lastCheckoutParams?.customerId, "cus_1");
});

test("reusing an operation ID with a different customer is refused as a conflict, not handed the earlier session", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  await billing.syncTier({ operationId: "sync-1", tier: tier() });
  const first = await billing.createCheckout({
    operationId: "checkout-1",
    tierId: "supporter",
    customerId: "cus_1"
  });
  assert.equal(first.status, "completed");
  const second = await billing.createCheckout({
    operationId: "checkout-1",
    tierId: "supporter",
    customerId: "cus_2"
  });
  assert.deepEqual(second, {
    status: "refused",
    operationId: "checkout-1",
    errorClass: "conflict"
  });
  assert.equal(state.createCheckoutCalls, 1);
});

test("createCheckout against an unsynced tier is refused as not-found", async () => {
  const { api } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.createCheckout({
    operationId: "checkout-1",
    tierId: "never-synced"
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "checkout-1",
    errorClass: "not-found"
  });
});

test("createPortal returns a typed session reference", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.createPortal({
    operationId: "portal-1",
    customerId: "cus_1"
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value, {
    id: "bps_1",
    url: "https://billing.stripe.example.test/bps_1"
  });
  assert.equal(state.lastPortalParams?.customerId, "cus_1");
});

test("a missing-customer refusal from the provider is mapped to not-found", async () => {
  const { api } = fakeApi({
    createPortalSession: () => Promise.reject({ statusCode: 404 })
  });
  const billing = createStripeBilling(api, scope);
  const result = await billing.createPortal({
    operationId: "portal-1",
    customerId: "cus_missing"
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "portal-1",
    errorClass: "not-found"
  });
});

test("a provider authorization refusal is mapped safely", async () => {
  const { api } = fakeApi({
    createProduct: () => Promise.reject({ statusCode: 401 })
  });
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "authorization"
  });
});

test("a rate-limited provider call fails with the rate-limit error class", async () => {
  const { api } = fakeApi({
    createProduct: () => Promise.reject({ statusCode: 429 })
  });
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "sync-1",
    errorClass: "rate-limit"
  });
});

test("an ambiguous connection timeout fails safely as unavailable", async () => {
  const { api } = fakeApi({
    createProduct: () =>
      Promise.reject({ type: "StripeConnectionError", code: "ETIMEDOUT" })
  });
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "sync-1",
    errorClass: "unavailable"
  });
});

test("an active product catalog spanning more than one page is refused, not resolved against a truncated page", async () => {
  const client = new Stripe("sk_test_fixture_key");
  let createdProduct = false;
  client.products = {
    list: async () => ({ data: [], has_more: true }),
    create: async () => {
      createdProduct = true;
      throw new Error("products.create must not run against a truncated catalog");
    }
  } as unknown as typeof client.products;
  const billing = createStripeBillingFromClient(client, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "conflict"
  });
  assert.equal(createdProduct, false);
});

test("a matching tier product on the first page is still refused when more pages exist", async () => {
  const client = new Stripe("sk_test_fixture_key");
  let createdProduct = false;
  client.products = {
    list: async () => ({
      data: [{ id: "prod_1", metadata: { tierId: "supporter" } }],
      has_more: true
    }),
    create: async () => {
      createdProduct = true;
      throw new Error("products.create must not run against a truncated catalog");
    }
  } as unknown as typeof client.products;
  const billing = createStripeBillingFromClient(client, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "conflict"
  });
  assert.equal(createdProduct, false);
});

test("a product's active prices spanning more than one page are refused, not resolved against a truncated page", async () => {
  const client = new Stripe("sk_test_fixture_key");
  let createdPrice = false;
  client.products = {
    list: async () => ({
      data: [{ id: "prod_1", metadata: { tierId: "supporter" } }],
      has_more: false
    })
  } as unknown as typeof client.products;
  client.prices = {
    list: async () => ({ data: [], has_more: true }),
    create: async () => {
      createdPrice = true;
      throw new Error("prices.create must not run against a truncated price page");
    }
  } as unknown as typeof client.prices;
  const billing = createStripeBillingFromClient(client, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "conflict"
  });
  assert.equal(createdPrice, false);
});

test("a product whose only active price is tiered is refused, not shadowed with a flat price", async () => {
  const client = new Stripe("sk_test_fixture_key");
  let createdPrice = false;
  client.products = {
    list: async () => ({
      data: [{ id: "prod_1", metadata: { tierId: "supporter" } }],
      has_more: false
    })
  } as unknown as typeof client.products;
  client.prices = {
    list: async () => ({
      data: [{ id: "price_tiered", unit_amount: null, currency: "usd", active: true }],
      has_more: false
    }),
    create: async () => {
      createdPrice = true;
      throw new Error("prices.create must not run for an unrepresentable tiered price");
    }
  } as unknown as typeof client.prices;
  const billing = createStripeBillingFromClient(client, scope);
  const result = await billing.syncTier({ operationId: "sync-1", tier: tier() });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "conflict"
  });
  assert.equal(createdPrice, false);
});

test("a non-integer tier price is refused as invalid-input with no provider mutation", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({
    operationId: "sync-1",
    tier: tier({ price: { minorUnits: 19.99, currency: "usd" } })
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "invalid-input"
  });
  assert.equal(state.createProductCalls, 0);
  assert.equal(state.createPriceCalls, 0);
});

test("a negative tier price is refused as invalid-input with no provider mutation", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({
    operationId: "sync-1",
    tier: tier({ price: { minorUnits: -500, currency: "usd" } })
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "invalid-input"
  });
  assert.equal(state.createProductCalls, 0);
  assert.equal(state.createPriceCalls, 0);
});

test("an unsupported-currency tier price is refused as invalid-input with no provider mutation", async () => {
  const { api, state } = fakeApi();
  const billing = createStripeBilling(api, scope);
  const result = await billing.syncTier({
    operationId: "sync-1",
    tier: tier({
      price: { minorUnits: 500, currency: "xyz" } as unknown as SponsorTier["price"]
    })
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "sync-1",
    errorClass: "invalid-input"
  });
  assert.equal(state.createProductCalls, 0);
  assert.equal(state.createPriceCalls, 0);
});
