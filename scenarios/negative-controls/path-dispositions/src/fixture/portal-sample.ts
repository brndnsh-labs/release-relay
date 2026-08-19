import { Stripe } from "stripe";

// A sample billing-portal session creator placed deliberately under a
// fixture path. The SDK usage is real and correctly attributed, but the
// source-path policy demotes fixture paths below the alertable band, so the
// reviewed expectation is a demoted observation. The secret key is an
// explicit parameter, never read from the environment, and the customer id
// and return URL are inert structural examples. The workspace compiles only
// and is never invoked.

// fixture-path-portal-sample
export async function samplePortalSession(secretKey: string): Promise<string> {
  const client = new Stripe(secretKey);
  const session = await client.billingPortal.sessions.create({
    customer: "cus_fixturesample",
    return_url: "https://relay.example/fixture-return"
  });
  return session.url;
}
