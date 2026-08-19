import type { Stripe } from "stripe";

// The composed deployment's sponsor-membership module. It owns no
// construction: the Stripe client is constructed in the composition root
// (src/relay.ts) and dependency-injected into a class-held field. The portal
// entry point is an arrow-function property so it can be passed as a
// callback without rebinding, and it reads the class-held client through
// `this`, exercising the arrow-function class-access shape at the actual
// call site. This workspace compiles only and is never given a real client.

export class SponsorPortal {
  constructor(private readonly client: Stripe) {}

  // sponsor-portal-session-client
  readonly openPortal = async (
    customerId: string,
    returnUrl: string
  ): Promise<string> => {
    const session = await this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl
    });
    return session.url;
  };
}
