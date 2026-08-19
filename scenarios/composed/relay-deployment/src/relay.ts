import { Anthropic } from "@anthropic-ai/sdk";
import { Stripe } from "stripe";
import { readComparisonRange } from "#relay/github/source-reader.js";
import draftReleaseBody from "#relay/drafting/drafter.js";
import { reviewDraft } from "#relay/review/reviewer.js";
import { SponsorPortal } from "#relay/billing/sponsor-portal.js";

// The composition root of the composed deployment. It constructs the
// Messages and Stripe clients that the review and sponsor-portal modules
// receive by dependency injection — those modules own no construction — and
// exposes the deployment's wiring as plain functions. Credentials are
// explicit parameters, never read from the environment. This workspace
// compiles only and is never invoked.

export interface DeploymentCredentials {
  githubToken: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  stripeSecretKey: string;
}

// composed-deployment-root
export function createDeployment(credentials: DeploymentCredentials) {
  const reviewClient = new Anthropic({ apiKey: credentials.anthropicApiKey });
  const billingClient = new Stripe(credentials.stripeSecretKey, {
    apiVersion: "2026-07-29.dahlia"
  });
  const sponsorPortal = new SponsorPortal(billingClient);
  return {
    readComparisonRange: (owner: string, repo: string, base: string, head: string) =>
      readComparisonRange(credentials.githubToken, { owner, repo, base, head }),
    draftReleaseBody: (bulletPoints: Parameters<typeof draftReleaseBody>[1]) =>
      draftReleaseBody(credentials.openaiApiKey, bulletPoints),
    reviewDraft: (draft: string) => reviewDraft(reviewClient, draft),
    openSponsorPortal: (customerId: string, returnUrl: string) =>
      sponsorPortal.openPortal(customerId, returnUrl)
  };
}
