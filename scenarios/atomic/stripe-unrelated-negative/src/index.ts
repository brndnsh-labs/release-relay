import { Stripe } from "stripe";

// A same-provider negative: a maintainer utility that calls the official
// Stripe SDK for an operation outside Release Relay's documented product
// workflow (sponsor-tier products and prices, Checkout, the billing
// portal, and signed webhooks). Checking the current account balance is
// real, correctly attributed Stripe API usage that should not be conflated
// with the sponsor-billing call sites in
// scenarios/atomic/stripe-checkout-session and
// scenarios/atomic/stripe-customer-portal. This workspace compiles only
// and is never invoked or given a real secret key.

export interface AvailableBalanceEntry {
  amount: number;
  currency: string;
}

// unrelated-negative-balance-client
export async function checkAccountBalance(
  secretKey: string
): Promise<readonly AvailableBalanceEntry[]> {
  const client = new Stripe(secretKey);
  const balance = await client.balance.retrieve();
  return balance.available.map(({ amount, currency }) => ({ amount, currency }));
}
