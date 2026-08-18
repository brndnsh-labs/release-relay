# API coverage strategy

## Purpose

Release Relay should give Breakscope a large, realistic, explainable source surface. Coverage is not measured by the number of vendor strings in the repository. It is measured by reviewed expectations: which call sites should be observed, which should not, and which should remain uncertain or low-confidence.

The checked-in Breakscope corpus remains the minimized unit of historical impact evaluation. Release Relay complements it with full-repository structure, interactions between files, real package manifests, and stable commit history.

## Two kinds of source

### Product source

Product source implements a workflow in the product specification. It uses normal application paths and names. Its integration usage should look like code a maintainer tool would genuinely ship.

### Coverage scenarios

Coverage scenarios preserve a historical, adversarial, alternative, or negative shape that would be unreasonable to force into the main application. Every scenario states its purpose and expected result in the oracle. Scenario code may be buildable rather than executable and must never make a live call.

No source may exist solely because it increases the observation count without adding a reviewed expectation.

## Provider coverage

### GitHub

Product operations include repository metadata, comparison ranges, pull requests, issues, contributors, releases, GitHub App or OAuth authentication, and an explicitly confirmed release write. Coverage should include Octokit packages, direct REST calls, API-version headers, pagination, webhook signatures, and same-provider negatives.

### OpenAI

Product operations include a structured release draft and bounded revision. Coverage should include the official SDK, model identifiers, a cached client, an injected adapter, a class-held client, and a raw Responses endpoint variant in scenarios.

### Anthropic

Product operations include a structured draft review and alternate draft. Coverage should include the official SDK, model identifiers, direct and wrapped message calls, and a raw Messages endpoint variant.

### Stripe

Product operations include products, prices, Checkout Sessions, customer portal sessions, subscriptions, and signed webhooks. Coverage should include the server SDK, browser Stripe.js in the future web application, cached and injected clients, REST endpoint variants, API-version configuration, and webhook construction.

## Shape matrix

The roadmap should eventually cover these dimensions without combining all of them in one unreadable file:

| Dimension | Planned shapes |
| --- | --- |
| Language | TypeScript, TSX, modern JavaScript, CommonJS migration example |
| Client construction | direct, factory, cached singleton, dependency injection, class field |
| Call expression | property chain, bracket access, alias, non-null wrapper, conditional client |
| Module flow | same-file, named export, default export, re-export, unambiguous path alias |
| HTTP | full URL, base plus path, template literal, `fetch`, narrow wrapper |
| Repository | single app, web plus worker, monorepo package, composed scenario |
| Evidence position | actual call argument, configuration, data literal, test path |
| Relation | positive, same-provider negative, unrelated-provider negative, ambiguous |
| Lifecycle | current usage, legacy usage, before-and-after migration revision |

Atomic scenarios vary one important dimension at a time. Composed scenarios combine reviewed atomic shapes into believable applications. Seeded generation may permute known templates, but the seed and generated output are committed so failures reproduce exactly.

## Negative controls

Negative controls are first-class. They include:

- unrelated services such as Slack, Twilio, AWS, Discord, and generic internal APIs;
- local classes named `OpenAI`, `Stripe`, `Octokit`, `Anthropic`, `api`, `client`, or `http` without the matching provider import or host;
- endpoint-looking strings in routing tables, documentation data, and allowlists;
- foreign HTTP clients that later call a path resembling a supported provider;
- same variable names reused across files and classes;
- shadowed imports and local bindings;
- test-only, fixture-only, generated, vendor, minified, oversized, binary, and unsupported files; and
- dynamic values whose provider or identifier cannot be proven.

A negative control declares whether the correct result is no observation, a demoted observation, file exclusion, or explicit uncertainty. Those outcomes are not interchangeable.

## Source-path policy

Normal positive usage belongs under `apps/*/src`, `packages/*/src`, or `scenarios/*/src`. A path containing `test`, `fixture`, `mock`, `e2e`, or similar terms may be intentionally demoted by Breakscope. Directories such as `generated`, `vendor`, build output, and dependency trees may be excluded entirely.

Do not rename an ordinary positive scenario into one of those paths accidentally. Conversely, do not hide an exclusion test in a normal path merely to obtain a stronger observation.

## Coverage review

Every integration story answers two questions:

1. What product behavior does this code implement?
2. What new or changed oracle expectation follows from the source?

Review compares actual Breakscope output with the oracle and classifies missing, unexpected, mismatched, uncertain, and excluded results. Raw counts are diagnostic only. The quality summary emphasizes observation precision, eligible observation recall, location accuracy, disposition accuracy, and stability for a pinned commit.

## Scale

Keep the default branch comfortably within ordinary repository archive and scan limits. Boundary and resource-exhaustion behavior belongs in purpose-built archive tests in Breakscope, not in a canary that makes every routine scan a stress test.

The corpus may become broad, but each scenario remains small enough to diagnose. Prefer ten readable scenarios with distinct expectations over one thousand generated calls whose failure cannot be attributed.
