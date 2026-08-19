import { Stripe } from "stripe";
import type {
  CheckoutSession,
  Money,
  OperationId,
  OperationResult,
  PortalSession,
  SafeErrorClass,
  SponsorBilling,
  SponsorTier,
  SyncedSponsorTier
} from "@release-relay/core";

const STRIPE_API_BASE_HOST = "api.stripe.com";
const RECURRING_INTERVAL = "month";

export interface StripeProductRecord {
  id: string;
  metadata: Record<string, string>;
}

export interface StripePriceRecord {
  id: string;
  unitAmount: number;
  currency: string;
  active: boolean;
}

export interface StripeCheckoutSessionRecord {
  id: string;
  url: string;
}

export interface StripePortalSessionRecord {
  id: string;
  url: string;
}

export interface StripeRequestOptions {
  idempotencyKey: string;
}

export interface StripeBillingApi {
  listProducts(params: { limit: number }): Promise<readonly StripeProductRecord[]>;
  createProduct(
    params: { name: string; metadata: Record<string, string> },
    options: StripeRequestOptions
  ): Promise<StripeProductRecord>;
  listPrices(params: { product: string }): Promise<readonly StripePriceRecord[]>;
  createPrice(
    params: { product: string; unitAmount: number; currency: string },
    options: StripeRequestOptions
  ): Promise<StripePriceRecord>;
  createCheckoutSession(
    params: {
      price: string;
      successUrl: string;
      cancelUrl: string;
      customerId?: string;
    },
    options: StripeRequestOptions
  ): Promise<StripeCheckoutSessionRecord>;
  createPortalSession(
    params: { customerId: string; returnUrl: string },
    options: StripeRequestOptions
  ): Promise<StripePortalSessionRecord>;
}

export interface StripeBillingScope {
  successUrl: string;
  cancelUrl: string;
  portalReturnUrl: string;
}

export interface LiveStripeBillingOptions extends StripeBillingScope {
  apiKey: string;
}

type FailureStatus = "refused" | "failed";

class AdapterError extends Error {
  constructor(
    readonly status: FailureStatus,
    readonly errorClass: SafeErrorClass
  ) {
    super("Stripe billing adapter rejected the operation");
  }
}

interface Failure {
  status: FailureStatus;
  errorClass: SafeErrorClass;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function isTimeout(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return error.code === "ETIMEDOUT" || error.type === "StripeConnectionError";
}

function classify(error: unknown): Failure {
  if (error instanceof AdapterError) {
    return { status: error.status, errorClass: error.errorClass };
  }
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return { status: "refused", errorClass: "authorization" };
  }
  if (status === 404) return { status: "refused", errorClass: "not-found" };
  if (status === 409 || status === 422) {
    return { status: "refused", errorClass: "conflict" };
  }
  if (status === 429) return { status: "failed", errorClass: "rate-limit" };
  if (status !== undefined && status >= 500) {
    return { status: "failed", errorClass: "unavailable" };
  }
  if (isTimeout(error)) return { status: "failed", errorClass: "unavailable" };
  return { status: "failed", errorClass: "unknown" };
}

async function run<T>(
  operationId: OperationId,
  action: () => Promise<T>
): Promise<OperationResult<T>> {
  try {
    return { status: "completed", operationId, value: await action() };
  } catch (error) {
    return { ...classify(error), operationId };
  }
}

function requiredText(value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdapterError("failed", "invalid-input");
  }
}

// Reusing an operationId returns the previously completed value instead of
// repeating the provider call; a retry that races an in-flight call joins it
// rather than starting a second one. A reused operationId whose fingerprint
// no longer matches what produced the cached value is refused as a conflict
// rather than handed the earlier (and possibly another caller's) result —
// mirroring publish.ts's previewHash comparison.
function createDeduper<T>() {
  const operations = new Map<OperationId, { fingerprint: string; value: T }>();
  const inFlight = new Map<OperationId, Promise<OperationResult<T>>>();
  return {
    call(
      operationId: OperationId,
      fingerprint: string,
      action: () => Promise<T>
    ): Promise<OperationResult<T>> {
      const stored = operations.get(operationId);
      if (stored !== undefined) {
        return Promise.resolve(
          stored.fingerprint === fingerprint
            ? { status: "duplicate", operationId, value: stored.value }
            : { status: "refused", operationId, errorClass: "conflict" }
        );
      }
      const flight = inFlight.get(operationId);
      if (flight !== undefined) return flight;
      const promise = run(operationId, action).then((result) => {
        if (result.status === "completed") {
          operations.set(operationId, { fingerprint, value: result.value });
        }
        return result;
      });
      inFlight.set(operationId, promise);
      void promise.finally(() => {
        if (inFlight.get(operationId) === promise) {
          inFlight.delete(operationId);
        }
      });
      return promise;
    }
  };
}

export function createStripeBilling(
  api: StripeBillingApi,
  scope: StripeBillingScope
): SponsorBilling {
  requiredText(scope.successUrl);
  requiredText(scope.cancelUrl);
  requiredText(scope.portalReturnUrl);

  const syncedTiers = new Map<string, SyncedSponsorTier>();
  const tierSync = createDeduper<SyncedSponsorTier>();
  const checkouts = createDeduper<CheckoutSession>();
  const portals = createDeduper<PortalSession>();

  async function resolveProduct(tier: SponsorTier): Promise<StripeProductRecord> {
    const products = await api.listProducts({ limit: 100 });
    const existing = products.find((product) => product.metadata.tierId === tier.id);
    if (existing !== undefined) return existing;
    return api.createProduct(
      { name: tier.name, metadata: { tierId: tier.id } },
      { idempotencyKey: `product:${tier.id}` }
    );
  }

  // Prices are immutable on Stripe: a changed tier price never mutates the
  // existing active price, it only ever reuses a matching one or creates a
  // new one alongside it.
  async function resolvePrice(
    product: StripeProductRecord,
    price: Money
  ): Promise<StripePriceRecord> {
    const prices = await api.listPrices({ product: product.id });
    const existing = prices.find(
      (candidate) =>
        candidate.active &&
        candidate.unitAmount === price.minorUnits &&
        candidate.currency === price.currency
    );
    if (existing !== undefined) return existing;
    return api.createPrice(
      { product: product.id, unitAmount: price.minorUnits, currency: price.currency },
      { idempotencyKey: `price:${product.id}:${price.minorUnits}:${price.currency}` }
    );
  }

  return {
    syncTier: (input) =>
      tierSync.call(input.operationId, JSON.stringify(input.tier), async () => {
        requiredText(input.tier.id);
        requiredText(input.tier.name);
        const product = await resolveProduct(input.tier);
        const price = await resolvePrice(product, input.tier.price);
        const synced: SyncedSponsorTier = {
          ...input.tier,
          providerProductId: product.id,
          providerPriceId: price.id
        };
        syncedTiers.set(input.tier.id, synced);
        return synced;
      }),

    createCheckout: (input) =>
      checkouts.call(
        input.operationId,
        JSON.stringify({ tierId: input.tierId, customerId: input.customerId }),
        async () => {
          const tier = syncedTiers.get(input.tierId);
          if (tier === undefined) {
            throw new AdapterError("refused", "not-found");
          }
          const session = await api.createCheckoutSession(
            {
              price: tier.providerPriceId,
              successUrl: scope.successUrl,
              cancelUrl: scope.cancelUrl,
              ...(input.customerId === undefined
                ? {}
                : { customerId: input.customerId })
            },
            { idempotencyKey: `checkout:${input.operationId}` }
          );
          return { id: session.id, url: session.url };
        }
      ),

    createPortal: (input) =>
      portals.call(
        input.operationId,
        JSON.stringify({ customerId: input.customerId }),
        async () => {
          requiredText(input.customerId);
          const session = await api.createPortalSession(
            { customerId: input.customerId, returnUrl: scope.portalReturnUrl },
            { idempotencyKey: `portal:${input.operationId}` }
          );
          return { id: session.id, url: session.url };
        }
      )
  };
}

function apiFromClient(client: Stripe): StripeBillingApi {
  // billing-adapter-client
  return {
    listProducts: async ({ limit }) => {
      const result = await client.products.list({ limit, active: true });
      return result.data.map((product) => ({
        id: product.id,
        metadata: product.metadata
      }));
    },
    createProduct: async (params, options) => {
      const product = await client.products.create(
        { name: params.name, metadata: params.metadata },
        options
      );
      return { id: product.id, metadata: product.metadata };
    },
    listPrices: async ({ product }) => {
      const result = await client.prices.list({ product, active: true, limit: 100 });
      return result.data.map((price) => ({
        id: price.id,
        unitAmount: price.unit_amount ?? -1,
        currency: price.currency,
        active: price.active
      }));
    },
    createPrice: async (params, options) => {
      const price = await client.prices.create(
        {
          product: params.product,
          unit_amount: params.unitAmount,
          currency: params.currency,
          recurring: { interval: RECURRING_INTERVAL }
        },
        options
      );
      return {
        id: price.id,
        unitAmount: price.unit_amount ?? params.unitAmount,
        currency: price.currency,
        active: price.active
      };
    },
    createCheckoutSession: async (params, options) => {
      const session = await client.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: params.price, quantity: 1 }],
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          ...(params.customerId === undefined ? {} : { customer: params.customerId })
        },
        options
      );
      if (session.url === null) {
        throw new AdapterError("failed", "unknown");
      }
      return { id: session.id, url: session.url };
    },
    createPortalSession: async (params, options) => {
      const session = await client.billingPortal.sessions.create(
        { customer: params.customerId, return_url: params.returnUrl },
        options
      );
      return { id: session.id, url: session.url };
    }
  };
}

export function createStripeBillingFromClient(
  client: Stripe,
  scope: StripeBillingScope
): SponsorBilling {
  return createStripeBilling(apiFromClient(client), scope);
}

export function createLiveStripeBilling(
  options: LiveStripeBillingOptions
): SponsorBilling {
  if (options.apiKey.trim() === "") throw new Error("apiKey is required");
  // Why: pins the API host to Stripe's documented default explicitly rather
  // than relying on the SDK's own DEFAULT_HOST constant, so a future SDK
  // change to that fallback can't silently redirect live requests.
  const client = new Stripe(options.apiKey, { host: STRIPE_API_BASE_HOST });
  return createStripeBillingFromClient(client, options);
}
