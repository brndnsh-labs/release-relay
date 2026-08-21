---
name: scout
description: Discovery-driven finder for release-relay — fans out read-only agents across security · performance · hygiene · context · a11y lenses, verifies each finding against the real code, dedupes against open issues, and files the worth-keeping candidates as actionable issues. Read-only over code: it FINDS and FILES, it never fixes, branches, or merges. Usage `/scout` (all lenses, tightly capped) or `/scout <lens>` (one focused lens, higher cap).
---
<!-- cycle:rendered template=skills/scout.md.tmpl hash=009543348c19 — managed by the-cycle; edit the template, not this file -->

# /scout — find release-relay's next work, on demand

Goal: surface maintenance and hardening work the code itself is hiding — before it becomes an
incident — and land it in the same tracker every other skill already reads. Every other pipeline
skill *consumes* the queue (`/next` picks, `/cycle` builds); `/scout` *generates* candidates from
the code.

**Shared rules in `.claude/skills/DOCTRINE.md` — read it if not already in context.** Scout files
issues, so the filing mechanics are **§10** — dedup, the actionable bar, the body format, the
budget. Don't restate them; apply them. Also leans on §1 (Status), §2 (the `scout` provenance
stamp), §5 (a finding that touches an always-brake surface still gets filed, just clearly flagged),
and §7 (the batch-write rule).

## The cardinal rule: scout finds and files. It never fixes, branches, or merges.

The surfaces scout is best at spotting — Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state, Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys, Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object, Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging, Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics, Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output, Deploying the application or creating hosted infrastructure; no environment is authorized by this repository — are exactly §5's always-brake class.
Auto-merging a speculative fix there is how a real incident happens. Discovery is cheap and
reversible; a shipped-without-review "fix" isn't. Scout's job stops at a well-specified issue.

## Lenses

Run **all lenses in one capped sweep** by default; pass a lens name for a focused, deeper pass.

- **`security`** — the trust boundary, secrets handling, authn/authz surfaces, dependency CVEs.
- **`performance`** — payload weight, render/hydration cost, query and index patterns, polling
  cadence, work done that didn't need doing.
- **`hygiene`** — type-safety erosion (`any`, unchecked casts, `@ts-expect-error`, non-null `!`),
  dead code, and drift between near-duplicate modules.
- **`context`** — **does the map still match the territory?** Do `CLAUDE.md`, the docs, and inline
  comments still describe the code as it is? A stale claim here misleads the next cold reader
  worse than no claim at all. Every finding in this lens must name **both** the wrong inference a
  cold reader would draw **and** the concrete in-tree artifact that fixes it.
- **`a11y`** — semantic HTML, focus management, touch-target size, reduced-motion, and anything
  that encodes meaning in color alone.

### API bait without product purpose

Look for provider imports, hosts, model IDs or endpoints in ordinary source that do not
implement a workflow in `docs/spec.md` and are not registered scenarios. More calls are
not automatically more coverage.

### Self-fulfilling oracle

Look for expected observations copied or generated from detector output, an oracle
change that lacks a source-intent rationale, or a comparator that treats empty,
excluded, demoted and uncertain as the same success.

### Hidden live behavior in mock mode

Look for SDK construction, environment reads, DNS, unseeded randomness, real clocks or
network fallbacks reachable from the default mock composition root or tests.

### Remote authority leaking across layers

Look for a read client that also exposes writes, a preview token not bound to exact
content, stale authorization reused after an async boundary, or a worker that can alter
an operation after confirmation.

### Provider types in the core

Look for SDK request/response or error types imported into `packages/core`. Core ports
express Release Relay operations; adapters own vendor types and mapping.

### Source-path confidence accident

Look for an ordinary positive scenario placed under a test, fixture, mock, generated or
vendor-shaped path, or for an exclusion scenario placed in normal source to make it
appear stronger than it is.

### Webhook and payment optimism

Look for JSON parsing before signature verification, browser redirects treated as
billing truth, non-integer money, duplicate events that repeat effects, or older events
that overwrite newer projected state.

### Arbitrary server-side URL

Look for a provider adapter, scenario helper or user input that supplies an unrestricted
base URL or redirect target. Provider hosts are fixed or compile-time allowlisted and
raw HTTP remains bounded.

## The budget — quality over flood (load-bearing)

Within §10.6's budget: **all-lenses run** — ~2 findings per lens, single digits overall;
**single-lens run** — the top 3–5.

**Filing zero because a lens is clean is a success, not a failure** — say so and stop. A flood of
marginal issues is worse than a missed one: it burns trust in the whole queue.

## Verify before filing (non-negotiable)

Every finding is a **hypothesis with a citation** until you've read the cited code. Open the file,
read the actual line, and confirm the claim — grep the *assignment*, not just a textual match. A
finding that turns out to be a misread costs more than the one you didn't file, because it teaches
Brandon to distrust the rest of the slate.

## File the fix already drafted (the fleshing-out rule)

A diagnosis-only issue hands Brandon homework; a drafted fix hands them a decision
(§10.3). Scout has already done the reading — it knows the file, the line, and what right looks
like — so the body carries that knowledge instead of describing where someone else might find
it. Every filed issue includes:

- **Evidence** — `file:line` plus a **verbatim quote** of the offending code, and, where one
  exists, the in-repo pattern that already does it right (the strongest possible spec: "make it
  match its sibling").
- **The failure scenario** — the concrete inputs/state → wrong outcome, and why it matters here.
- **The drafted fix** — the concrete change: a diff block, or the exact edit stated precisely
  enough to apply without re-deriving the analysis. The decision becomes *"ship this? y/n"*, and
  the eventual builder starts from the draft instead of from zero.
- **Acceptance** a gate or a look can actually verify.

A finding you can't draft a fix for usually isn't actionable enough to file — put it in the
report as an observation instead. The one exception: a genuine defect whose fix needs a design
call — file it with the options sketched and route it `status:needs-decision` (§10.5),
never pickable.

## Workflow

1. **Pick the lenses** (all, or the named one).
2. **Sweep, read-only.** Fan out across the lenses; each returns candidate findings with
   `file:line` citations.
3. **Verify each candidate against the real file.** Drop anything that doesn't survive.
4. **Dedup** (§10.1) — open *and* recently-closed issues. A closed-unfixed twin is a rejection
   with memory: report it, don't re-file it.
5. **Rank and cut to budget.**
6. **Present the slate** — each finding with its lens, `file:line`, the drafted issue body
   **including its drafted fix**, its §10.5 certainty call with one line of why, and whether it
   lands on a §5 brake. This is a §5 plan — shown for visibility, then acted on in the same turn;
   an unattended run's standing go folds it into the report.
7. **File** (§7): `gh issue create --title "<title>" --body "<body>" --label "scout"` per finding, then route each by
   its certainty call (§10.5) — deterministic → `gh issue edit "<n>" --remove-label "status:ready,status:in-progress,status:in-review,status:blocked,status:needs-decision" && gh issue edit "<n>" --add-label "status:ready"`,
   interpretive → `gh issue edit "<n>" --remove-label "status:ready,status:in-progress,status:in-review,status:blocked,status:needs-decision" && gh issue edit "<n>" --add-label "status:needs-decision"`, unsure → no status write —
   plus anything this repo's lens table adds. A plain loop is correct here; these are REST calls,
   and there is nothing to batch around. Tracker unreachable → say so and stop; don't pretend it
   filed.
8. **Report.** What was filed (links, labels, which ones flag a §5 brake for later), what was found
   but not filed (dups, below-the-cut, "clean on this lens"), and point at `/next`.

## Guardrails

- **Find and file only — never fix, branch, or merge.** If it's tempting to "just fix this one,"
  file it instead and let `/cycle` do it with a human watching.
- **Verify every finding against the real file before it reaches the slate.** Non-negotiable.
- **Respect the budget.** Fewer, sharper issues beat a flood; zero is a fine outcome.
- **Dedup is not optional.**
- **Read-only until the step-6 slate is shown.** Presenting it is a §5 plan, not a "Proceed?"
  prompt — but nothing is created before it exists.
- **Always-brake findings still get filed** — just clearly labeled as needing `/security-review` at
  build time, never framed as a quick auto-mergeable patch.

## How it fits the pipeline

- **`/scout`** = code → candidate issues (the discovery front door).
- **`/next`** = ranks and picks. A scout-filed issue arrives already routed by §10.5's certainty
  call: deterministic findings are pickable on arrival, interpretive ones sit on Brandon's
  decision queue with the fix pre-drafted, and only the genuinely unsure land under **Untriaged**.
- **`/implement` / `/cycle`** = build a picked issue; §5 still brakes regardless of who filed it.
- **`/burndown`** = curates the believed-safe subset and loops `/cycle` over it.
