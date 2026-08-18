# Roadmap

## How to read this roadmap

GitHub milestones are the delivery epics and GitHub issues are the executable stories. This document records product order, dependencies, and milestone completion conditions; the live tracker records current state.

Stories are intentionally small enough for a focused model to implement, test, review, and ship in one `/cycle`. Every story must retain the Why, Touches, Fix, Acceptance, Dependencies, and Non-goals sections from its issue.

## M1 — Core and mock foundation

Goal: establish strict domain contracts and a deterministic offline runtime before choosing a web framework or persistence layer.

Planned stories:

1. Implement the versioned coverage-oracle schema and validator.
2. Define release-workspace and candidate-item state transitions.
3. Define provider ports and typed operation results.
4. Build the deterministic mock runtime and operation ledger.

Complete when the core workflows can be modeled and tested without any SDK, network, UI, database, or ambient credential.

## M2 — GitHub release workspace

Goal: assemble a release candidate from GitHub-shaped data and preserve a hard boundary before publication.

Planned stories:

1. Implement a mock-backed GitHub reader and source-grounded candidate assembler.
2. Add the official GitHub read adapter for comparison, pull-request, issue, contributor, and release data.
3. Implement release preview plus explicit confirmation and idempotent publication.

Complete when mock mode supports the full candidate workflow and the live adapter is isolated behind separately configured read and write capabilities. Actual live calls remain manually gated.

## M3 — AI drafting and review

Goal: create grounded structured release drafts through either AI provider while preserving provider identity and validation.

Planned stories:

1. Define the structured draft, provenance, validation, and revision contracts.
2. Implement the OpenAI release-draft adapter with mocked contract tests.
3. Implement the Anthropic review and alternate-draft adapter with mocked contract tests.

Complete when deterministic mocks exercise drafting, review, invalid output, refusal, and provider switching without network access. Live evaluation is a separate explicit action.

## M4 — Sponsor memberships

Goal: model sponsor tiers and Stripe-hosted membership flows without handling card data or trusting redirects.

Planned stories:

1. Define sponsor-tier, customer, membership, and money contracts.
2. Implement idempotent Stripe product, price, Checkout, and portal operations behind the billing port.
3. Implement raw-body signature verification and idempotent webhook projection.

Complete when mock mode proves successful, duplicate, failed, and out-of-order billing flows, and every live mutation remains an explicit approval surface.

## M5 — Coverage expansion

Goal: turn the coherent application into a broad, diagnosable repository scan corpus.

Planned stories:

1. Add reviewed direct-SDK atomic scenarios for all four providers.
2. Add cross-module wrapper, singleton, class-field, and re-export scenarios.
3. Add raw-HTTP, unrelated-provider, same-provider-negative, and path-disposition scenarios.

Complete when every scenario has validated independent expectations and the suite reports useful precision, recall, location, confidence-band, and disposition results rather than raw observation totals.

## M6 — Breakscope canary

Goal: exercise Breakscope's real repository path against pinned Release Relay revisions and make silent misses visible.

Planned stories:

1. Define a pinned cross-repository comparison report and reproducible archive input.
2. Document and perform the read-only Breakscope GitHub App installation and first scan.
3. Add a scheduled operational comparison that records both repository revisions and never writes an alert automatically.

Complete when a maintainer can distinguish a healthy matching scan from missing, unexpected, uncertain, excluded, or operationally failed results and reproduce a reported mismatch from pinned commits.

## Dependency order

M1 is the only initially pickable milestone. Later milestones may be filed with `status:blocked` where their dependencies are concrete. `/cycle next --until-blocked` stops after the last issue in each milestone so the contract can be reviewed before the next layer begins.

Architecture decisions that remain open are not hidden inside implementation issues. If a story reaches a framework, persistence, hosted-auth, live-call, billing, or deployment decision without an established contract, it stops and produces a narrowly framed `status:needs-decision` issue.
