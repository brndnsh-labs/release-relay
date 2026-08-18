# Security model

## Scope

Release Relay is public and synthetic. The initial repository contains no hosted service, real accounts, credentials, customer data, or live integrations. These rules define what future implementation issues must preserve.

## Default-deny runtime

A clean checkout runs in deterministic mock mode. The absence of configuration never activates a provider. Live reads, content-bearing AI calls, GitHub writes, Stripe writes, and deployment are separate capabilities rather than one global “live” switch.

Mock mode must not resolve provider hosts, load ambient credentials, or silently delegate to a real SDK client. Tests should fail if a network-capable adapter is constructed unintentionally.

## Credentials

- Never commit credentials, signed URLs, webhook secrets, private keys, or realistic secret-shaped samples.
- Environment variables are read only at application composition roots.
- Credentials are passed to the smallest provider adapter that needs them.
- Logs, errors, snapshots, issue bodies, and Breakscope oracle files never contain credentials.
- Examples use structural placeholders such as `example_not_a_secret`, not strings with real provider secret prefixes.
- Command-line tools accept secrets through protected environment or standard input, never process arguments.

Because the repository is intended for public scanning, “temporary” credential files are still prohibited.

## AI providers

Sending a release candidate to OpenAI or Anthropic is data egress. A live call requires explicit user intent, a bounded preview of included fields, and provider-specific configuration. Provider adapters receive no arbitrary tools or credentials beyond their own API credential.

Structured responses are runtime-validated. Generated claims retain source references and unsupported references are rejected or shown as unresolved. Raw prompts, complete provider responses, and maintainer edits are not logged.

Switching providers does not implicitly resend previous content. Asking a second provider to review a draft is a separate visible action.

## GitHub

Read authorization and write authorization are distinct. Repository selection comes from authenticated GitHub identity and current access, not an untrusted repository name submitted by a browser.

Before publication, the application renders the exact repository, tag, title, and body; verifies current access; obtains a short-lived explicit confirmation; and binds that confirmation to an idempotent operation ID. A retry may repeat the identical operation but cannot change its target or content.

Webhook payloads are verified against their raw bytes before parsing and are deduplicated by delivery identity plus payload hash. A duplicate delivery with different bytes is rejected.

## Stripe

Release Relay never handles card numbers. Checkout and billing management use Stripe-hosted pages. Return URLs are user experience only and never establish payment state.

Webhook signatures are verified before JSON parsing. Events are idempotently projected, tolerate duplicates and out-of-order delivery, and retain the provider event identity. Live creation or mutation of customers, products, prices, sessions, subscriptions, or portal sessions is a judgment call requiring explicit approval.

Money amounts use integer minor units plus an explicit currency. Product and price synchronization must be idempotent and must not silently replace an active price.

## External URLs and HTTP

Provider base URLs are fixed by the adapter or selected from a compile-time allowlist for documented test environments. No public or internal interface accepts an arbitrary URL for a server-side fetch. Redirects, response sizes, content types, and timeouts are bounded where raw HTTP is used.

Scenario packages that demonstrate unsafe-looking inputs must keep them inert and explain the expected security outcome. They may not contain executable credential harvesting, callbacks to external collectors, or hidden network behavior.

## Data minimization

Core records store provider resource identities, GitHub source links, structured release items, approved drafts, operation metadata, and projected billing status. The design does not require cloning or retaining repository source.

If persistence is introduced, retention and tenant boundaries must be specified before schema work begins. The initial in-memory implementation does not authorize an ad hoc production database.

## Logs and errors

Safe logs include operation ID, provider, operation name, result state, duration, and redacted resource identifiers. Unsafe logs include request bodies, prompts, drafts, webhook payloads, raw provider errors, Checkout URLs, authorization headers, cookies, or environment values.

Adapters map provider failures into typed safe error classes. Debugging convenience does not justify emitting raw errors from a live SDK.

## Human and workflow gates

The repository-specific `/cycle` workflow must stop for:

- adding or running live provider calls;
- any remote GitHub or Stripe mutation;
- deployment or infrastructure creation;
- authentication, authorization, credential, webhook-signature, or payment-state design changes;
- persistence schema or destructive data operations;
- broadening allowed provider hosts or weakening request bounds; and
- weakening the independent-review rules for the Breakscope oracle.

Mechanical mock implementations and pure domain work may proceed unattended when fully specified and proven by local gates.
