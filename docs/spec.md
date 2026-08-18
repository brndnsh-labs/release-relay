# Product specification

## Product statement

Release Relay helps a solo maintainer or small open-source team turn merged GitHub work into a reviewed release and an optional sponsor update. It gathers the source material, preserves links back to that material, drafts communications with a chosen AI provider, keeps a human in control of publication, and provides a lightweight way for supporters to fund the project.

The product is deliberately narrow. It is not a general project-management system, an autonomous release bot, or a payment platform. It is the short bridge between “the work merged” and “the release and its supporters were told clearly.”

The repository is also a public Breakscope canary. That purpose affects how integrations are expressed and reviewed, but it must not justify incoherent product behavior.

## Users

### Primary: hands-on maintainer

The primary user owns one or more GitHub repositories, understands their releases, and wants help assembling accurate communication without surrendering the final decision. They may work alone or with a small trusted team.

### Secondary: release collaborator

A collaborator can review candidate items and AI drafts but cannot publish or change billing configuration unless explicitly granted that capability in a future authorization design.

### Recipient: supporter

A supporter reads public release updates and may choose a recurring sponsorship tier. They do not need a Release Relay account for the planned MVP.

## Core workflows

### 1. Assemble a release candidate

1. The maintainer selects a connected GitHub repository and a comparison range.
2. Release Relay reads merged pull requests, closed issues, contributors, labels, and prior releases.
3. The maintainer includes, excludes, reorders, or annotates candidate items.
4. Every retained item preserves its GitHub URL and source identity.
5. The candidate can be saved without calling an AI provider.

When a merged pull request is linked to an issue, the pull request is the
candidate's primary source and the issue is not duplicated. Reverted work is
retained as excluded source material rather than presented as a release change.

Success means the maintainer has an editable, source-grounded release outline. Reading GitHub data is not permission to mutate GitHub.

### 2. Draft and review release communication

1. The maintainer chooses OpenAI or Anthropic as the drafting provider.
2. Release Relay sends only the selected, bounded candidate material.
3. The provider returns a structured draft containing a title, summary, grouped changes, acknowledgements, and supporter note.
4. The response is validated and tied back to supplied source items. Unsupported claims are shown as validation failures, not silently accepted.
5. The maintainer may ask the other provider for a review or alternative draft.
6. Human edits remain distinguishable from generated text in the local revision history.

Success means the user has a useful draft with visible provenance. The system does not choose truth by provider consensus.

### 3. Publish a GitHub release

1. Release Relay renders the exact target repository, tag, title, and body.
2. The maintainer previews the remote mutation.
3. Immediately before the write, Release Relay re-checks authorization and asks for explicit confirmation.
4. A stable operation key prevents a retry from creating a second release.
5. The resulting GitHub release URL is recorded in the workspace.

Success means one intended release exists. Draft generation never implies publication permission.

### 4. Offer sponsor memberships

1. The maintainer defines a small set of supporter tiers and public descriptions.
2. Release Relay creates or reuses the matching Stripe product and price only after an explicit live-mode action.
3. A supporter enters Stripe-hosted Checkout and returns to a public result page.
4. Signed Stripe webhooks project subscription state idempotently.
5. The maintainer can open Stripe's hosted billing portal for a known customer rather than implementing payment-method handling.

Success means Release Relay can present current supporter status without storing card data or treating a browser redirect as payment proof.

### 5. Send a sponsor update

The maintainer derives a supporter-facing update from an approved release draft, reviews it, and records its intended audience. Actual outbound email or messaging is outside the initial roadmap; the MVP produces an exportable update and audit record.

## Product principles

- Source links beat generated confidence.
- Read operations and write authority remain separate.
- Mock mode is a complete local product path, not a degraded error fallback.
- Provider choice remains visible; a generic AI abstraction must not erase meaningful differences in structured output or safety behavior.
- Billing state comes from verified webhooks, not query parameters or optimistic browser state.
- The same revision always produces the same seeded synthetic scenarios and expected scan oracle.

## MVP acceptance

The first useful product milestone is complete when a developer can run the system locally without credentials and:

1. create a maintainer workspace;
2. select a synthetic GitHub repository and comparison range;
3. assemble and edit a release candidate with source links;
4. request deterministic mock drafts from both AI-provider interfaces;
5. compare, revise, and approve one draft;
6. preview and explicitly confirm a simulated GitHub release publication;
7. define a sponsor tier and complete a simulated Stripe Checkout flow;
8. process duplicate and out-of-order simulated webhooks safely; and
9. inspect which external operations would have occurred.

Live credentials, production deployment, multi-tenant authorization, real charges, and real GitHub writes are not required for MVP completion.

## Non-goals

- Autonomous publishing, merging, tagging, or charging.
- Replacing GitHub Issues, Projects, or Discussions.
- Full accounting, tax, entitlement, or donor-management functionality.
- Arbitrary user-supplied provider base URLs.
- Sending email or operating a general notification service.
- Supporting providers beyond GitHub, OpenAI, Anthropic, and Stripe before the initial oracle is useful.
- Maximizing raw observation count at the expense of believable code.

## Product states

A release workspace progresses through `collecting`, `drafting`, `review`, `approved`, and `published`. Transitions are explicit. `published` requires a confirmed GitHub result, not merely an attempted request.

A sponsor membership is projected as `pending`, `active`, `past_due`, `canceled`, or `unknown`. `unknown` is preferable to inferring state from incomplete or unverified input.

## Open decisions

These are deliberately deferred and should become `status:needs-decision` issues only when they block a scheduled milestone:

- whether a future hosted version uses a GitHub App, OAuth app, or both;
- which persistent database and job system a hosted version should use;
- whether generated draft revisions require durable storage or remain local to a workspace;
- whether sponsor updates are ever sent directly rather than exported.
