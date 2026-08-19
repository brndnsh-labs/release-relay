import type { Stripe } from "stripe";

// A maintainer helper that creates a sponsor billing-portal session through
// a dependency-injected client field, varying the client-construction
// shape from the factory-constructed client in
// scenarios/atomic/stripe-checkout-session and from
// packages/stripe-integration/src/billing.ts's injected adapter. This
// workspace compiles only and is never invoked or given a real client.

export class CustomerPortalHelper {
  constructor(private readonly client: Stripe) {}

  // customer-portal-create-client
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<{ id: string; url: string }> {
    const session = await this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });
    return { id: session.id, url: session.url };
  }
}
