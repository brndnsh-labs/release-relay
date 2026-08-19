// A maintainer helper that opens a sponsor billing-portal session through a
// raw Stripe endpoint request addressed by a template literal over a fixed
// base host, rather than through the official SDK or Release Relay's
// injected adapter. The form encoding follows the documented endpoint
// content type, the customer and return URL are inert structural examples,
// and the secret key is an explicit parameter, never read from the
// environment. This workspace compiles only and is never invoked, so the
// request can never execute.

const portalHost = "https://api.stripe.com";

// template-portal-request
export async function openPortalViaTemplateLiteral(
  secretKey: string,
  customerId: string,
  returnUrl: string
): Promise<string> {
  const response = await fetch(`${portalHost}/v1/billing_portal/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      customer: customerId,
      return_url: returnUrl
    })
  });
  if (!response.ok) {
    throw new Error(`Portal request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { url?: string };
  return payload.url ?? "";
}
