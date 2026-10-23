---
name: scout
description: Find release-relay's next work in the code itself — sweep read-only across security · performance · hygiene · context · a11y lenses, verify every finding against the real code, dedupe, and file the few worth keeping as actionable issues with the fix drafted. Finds and files; never fixes. Usage `/scout` (all lenses, tightly capped) or `/scout <lens>` (one lens, deeper).
---
<!-- cycle:rendered template=skills/scout.md.tmpl hash=7a50a2e3290c — managed by the-cycle; edit the template, not this file -->

# /scout — find work the code is hiding

**Shared rules in `.agents/skills/DOCTRINE.md` — read it if not already in context.** Filing — dedup,
format, routing by certainty, budget — is §2.

**Scout finds and files; it never fixes, branches, or merges.** The surfaces it's best at spotting
are often §5 brake surfaces, where a speculative fix shipped without a human look is how incidents
happen.

## Lenses

Sweep all lenses in parallel read-only agents by default; a named lens gets one deeper pass.

- **`security`** — trust boundaries, secrets, authn/authz, dependency CVEs.
- **`performance`** — payload weight, render cost, queries and indexes, polling, needless work.
- **`hygiene`** — type-safety erosion, dead code, drift between near-duplicate modules.
- **`context`** — do `CLAUDE.md`, the docs, and comments still describe the code? Each finding names
  the wrong inference a cold reader would draw *and* the artifact that should fix it.
- **`a11y`** — semantics, focus, touch targets, reduced motion, meaning carried by color alone.

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

## Rules

- **Verify before filing.** Every candidate is a hypothesis until you've read the cited line. A
  misread on the slate teaches Brandon to distrust the rest.
- **File the fix already drafted** — evidence (`file:line` + a quote, and the sibling that already
  does it right, if any), the failure scenario, the concrete fix, and Acceptance a gate or a look
  can verify. Can't draft a fix → it's an observation for the report, unless it's a real defect
  needing a design call (file it as `status:needs-decision` with options sketched).
- **Budget:** about 2 per lens on a full sweep, 3–5 on a single lens. Zero is a success.

### Broader threads are a handoff, not an implicit wider sweep

When a finding exposes a pattern that probably repeats elsewhere, gather just enough evidence to
show it's credible, distinguish likely surfaces from verified ones, and finish the current sweep.
In the report, describe the pattern, the confirmed and likely surfaces, whether one issue is
sufficient or several independent issues are warranted, and the focused follow-up `/scout <lens>`
pass that would investigate it. Do **not** automatically broaden the current sweep, file
speculative related issues, or open an umbrella.

## Steps

1. Sweep → candidates with citations.
2. Verify each against the real file; drop what doesn't survive.
3. Dedup against open and recently closed issues (§2).
4. Rank, cut to budget, and show the slate — each with lens, evidence, drafted fix, routing, and
   whether it touches a §5 brake. Then file in the same turn.
5. File: `gh issue create --title "<title>" --body "<body>" --label "scout"`, then route by certainty (§2).
6. Report what was filed, what was found but not filed (and why), any credible **broader thread**
   handoff from above, and point at `/next`.
