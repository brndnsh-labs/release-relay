import { Stripe } from "stripe";

// A maintainer helper that creates a sponsor Checkout Session through a
// factory-constructed client pinned to an explicit API version, varying
// both the client-construction shape and the API-version dimension from
// packages/stripe-integration/src/billing.ts's injected adapter, which
// pins only the host. The secret key is an explicit parameter, never read
// from the environment. This workspace compiles only and is never invoked.

export interface CheckoutSessionRequest {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

function createClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2026-07-29.dahlia" });
}

// checkout-session-create-client
export async function createSponsorCheckoutSession(
  secretKey: string,
  request: CheckoutSessionRequest
): Promise<{ id: string; url: string | null }> {
  const client = createClient(secretKey);
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: request.priceId, quantity: 1 }],
    success_url: request.successUrl,
    cancel_url: request.cancelUrl
  });
  return { id: session.id, url: session.url };
}
