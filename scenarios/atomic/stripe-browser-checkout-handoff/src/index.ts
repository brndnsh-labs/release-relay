import { loadStripe } from "@stripe/stripe-js";

// A minimal browser hand-off to a sponsor Checkout Session that the server
// already created and returned as a hosted URL. Stripe.js here only loads
// with the publishable key to confirm the client environment is ready; it
// never collects or touches card data, and the redirect itself is an
// injected callback so this workspace has no DOM library dependency. The
// publishable key below is an explicit parameter and an unmistakably fake
// structural value, never a real credential. This workspace compiles only
// and is never invoked.

// browser-checkout-handoff-client
export async function handOffToHostedCheckout(
  publishableKey: string,
  checkoutUrl: string,
  redirect: (url: string) => void
): Promise<void> {
  const stripe = await loadStripe(publishableKey);
  if (stripe === null) return;
  redirect(checkoutUrl);
}
