# Roadmap

## How to read this roadmap

GitHub milestones are the delivery epics and GitHub issues are the executable stories. This document records product order, dependencies, and milestone completion conditions; the live tracker records current state.

Stories are intentionally small enough for a focused model to implement, test, review, and ship in one `/cycle`. Every story must retain the Why, Touches, Fix, Acceptance, Dependencies, and Non-goals sections from its issue.

## Delivery status

| Milestone | Status | Retrospective result |
| --- | --- | --- |
| M1 — Core and mock foundation | Complete | Domain contracts, provider ports, the oracle schema, and the operation ledger build and test without credentials or network access. |
| M2 — GitHub release workspace | Complete | Mock-backed assembly, scoped live reads, and preview-bound idempotent publication remain separate capabilities. Malformed comparison and repository identities are rejected at the boundary. |
| M3 — AI drafting and review | Complete | OpenAI drafting and Anthropic review retain provider/model provenance, validate structured output, cover refusal and invalid-output paths, and use injected clients in offline tests. Live evaluation remains a separate explicit action. |
| M4 — Sponsor memberships | Complete | Money and membership contracts, idempotent Stripe operations, and raw-body verified webhook projection cover duplicate, failed, and out-of-order paths without trusting redirects or handling card data. Live Stripe mutations remain explicitly gated. |
| M5 — Coverage expansion | Complete | The reviewed manifest covers product adapters plus atomic SDK, composed module-flow, raw HTTP, negative-control, demoted, excluded, and uncertain cases. The comparator reports each dimension independently without learning truth from detector output. |
| M6 — Breakscope canary | Active | The v1 offline comparator is complete; v2 normalization is complete but v2 comparison is staged (blocked on #52). The first operational scan is blocked on a reviewed source-free Breakscope export path, healthy production preflight, and a fresh approval immediately before any repository-selection change. Do not run `coverage-oracle compare` on `reportVersion:2` until #52 ships. |

The completion judgments above were rechecked on 2026-08-19 against the merged source, issue acceptance criteria, and a green current-head CI run. M3–M5 introduced no hosted Release Relay runtime, ambient credential dependency, persistence layer, or implicit live-provider activation, so the contracts still support the M6 boundary.

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

The exact operational boundary, current blockers, required evidence, and fresh approval stop are maintained in [`canary-runbook.md`](canary-runbook.md).

Complete when a maintainer can distinguish a healthy matching scan from missing, unexpected, uncertain, excluded, or operationally failed results and reproduce a reported mismatch from pinned commits.

## Dependency order

M1 was the only initially pickable milestone. M1–M5 are now complete; M6 work remains dependency-routed in the live tracker. `/cycle next --until-blocked` stops after the last issue in each milestone so the contract can be reviewed before the next layer begins.

Architecture decisions that remain open are not hidden inside implementation issues. If a story reaches a framework, persistence, hosted-auth, live-call, billing, or deployment decision without an established contract, it stops and produces a narrowly framed `status:needs-decision` issue.
