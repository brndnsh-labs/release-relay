---
name: review
description: Independently review the current uncommitted release-relay diff (or a named branch/PR) — correctness, plus whether it does what the issue asked — adding `/security-review` when it touches an always-brake surface (Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state, Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys, Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object, Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging, Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics, Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output, Deploying the application or creating hosted infrastructure; no environment is authorized by this repository). Reports findings with evidence; fixing them is the caller's job. Used by /cycle, or on its own for any diff.
---
<!-- cycle:rendered template=skills/review.md.tmpl hash=f02815a88d7b — managed by the-cycle; edit the template, not this file -->

# /review — fresh eyes on a diff

**Shared rules in `.claude/skills/DOCTRINE.md` — read it if not already in context** (§3 says how
much review a change deserves; §5 says when to stop).

**Run it in a fresh-context subagent** when the caller built the diff: hand it the issue number
and the diff, not your reasoning. The value is a reviewer who doesn't share the builder's
assumptions. If a subagent can't be launched at all, don't stall: review in-thread, re-reading
the issue and the diff from scratch, and say that's what happened.

## What to check

- **Correctness — the inline correctness pass.** Logic, edge cases, error paths, contracts,
  invariants. Depth matches risk. Tests beside production code are supporting cast; the behavior
  change is the subject.
- **Spec — kept separate.** Read the issue's Acceptance and its comments, and report against them:
  a criterion missing or half-met, behavior nobody asked for, or a criterion addressed in a way that
  won't actually satisfy it. Quote the acceptance line, and tag these `[spec]`. No issue in context
  → say "no spec available"; never reconstruct one from the diff.
- **Tests that are the deliverable — the test-quality lens.** Do they assert the contract or just
  restate the implementation? Can each assertion actually fail? A test that enshrines a bug is a
  finding, however green.
- **Brake surfaces** (Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state, Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys, Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object, Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging, Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics, Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output, Deploying the application or creating hosted infrastructure; no environment is authorized by this repository): also run `/security-review`, reasoning about this flow's
  threat model, not generic categories.
- **A big or subtle diff:** a second reviewer on a different model catches same-prior blind spots.
  The heavyweight `/code-review` is human-triggered — if a diff deserves it, say so and leave the
  call to Brandon.

No specialized reviewer agents exist yet; all rows currently receive an inline
correctness pass. The domain column is the brief for that pass and the backlog for
future focused reviewers.

| Path | Reviewer | Responsible for |
| --- | --- | --- |
| `packages/core/**` | domain reviewer *(not written)* | Valid state transitions, provider-independent contracts, exhaustive outcomes and no SDK type leakage. |
| `packages/mock-runtime/**` | mock reviewer *(not written)* | No ambient credentials, clocks, randomness, DNS or network; deterministic operation ledger and failure injection. |
| `packages/github-integration/**` | GitHub/security reviewer *(not written)* | Read/write capability separation, current access, exact preview, confirmation binding, idempotency, webhook verification and safe pagination. |
| `packages/openai-integration/**`, `packages/anthropic-integration/**` | AI/security reviewer *(not written)* | Bounded egress, current SDK contracts, structured validation, source provenance, refusal handling and safe logs. |
| `packages/stripe-integration/**` | billing/security reviewer *(not written)* | Integer money, hosted payment surfaces, signature-before-parse, event idempotency, out-of-order projection and no redirect-based truth. |
| `packages/coverage-oracle/**`, `scenarios/**` | oracle reviewer *(not written)* | Ground truth independent of detector output, unique neutral anchors, correct confidence/disposition semantics and diagnosable scenarios. |
| `apps/**` | application reviewer *(not written)* | Composition roots own config; UI cannot infer write authority; modes and operation results remain visible. |
| `docs/**`, `CLAUDE.md` | inline | Behavior and planned contracts agree; future claims are not written as shipped capabilities. |
| anything else | inline general review | Intent, edge cases, error paths, tests and repository conventions. |

## Reporting

- Each finding: an ID (`F1`, `F2`, …), severity (P0 / P1 / P2), `file:line`, a verbatim quote of the
  line, and what's wrong. **Read the cited line before reporting it** — a confidently wrong finding
  costs more than a missed one.
- End with one verdict: **clean**, **fixable** (mechanical findings — fix and re-check), or
  **needs Brandon** (a design call, a P0 on a brake surface, or a contradiction with a project
  memory note — which wins by default, but surface it).
- No findings is a valid result. A reviewer that errored or timed out is a *missing* result — say
  so; never report it as clean.
- **Re-check mode:** when called again after fixes, confirm each original ID against the current
  tree (fixed / still open) and look at the fix itself for new problems. If the fix grew into new
  behavior, do a full review instead.
