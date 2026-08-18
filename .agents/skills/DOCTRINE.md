<!-- cycle:rendered template=DOCTRINE.md.tmpl hash=9192ef4b9563 — managed by the-cycle; edit the template, not this file -->
# Pipeline doctrine (shared)

Single source of truth for the rules the release-relay work-loop skills share. A skill that says
"see DOCTRINE §X" means *this* file. **If this isn't already in your context, read it once** —
within a session the read amortizes across every pipeline skill you run.

Reconcile here, not in the skills: when a rule changes, edit this file, not the skills that
restate it. The skills hold only their *unique* procedure.

Release Relay is both a believable maintainer application and a public synthetic
Breakscope canary. Product coherence and reviewed ground truth matter more than raw
API-call count.

- **Useful first.** Ordinary source implements a workflow in `docs/spec.md`.
- **Mock first.** Green gates require no credentials, network or provider accounts.
- **Explicit writes.** Drafting, remote mutation and deployment are separate powers.
- **Independent truth.** The scan oracle is written from source intent, never blessed
  from the detector's current output.

---

## §1 Tracker & readiness

The tracker is **GitHub issues** (`brndnsh-labs/release-relay`). A **story = an issue**: its **body** holds
Why / Touches / Acceptance; routing lives in its **labels** (§3). **Milestones = epics.**

**"The board" is the open issue list** — there is no separate artifact to keep in sync, and
nothing to be on or off. Status is one `status:*` label on the issue itself.

| Status label | Meaning | Pipeline action |
| --- | --- | --- |
| `status:ready` | scoped, dependency-clear and pickable | `/next` ranks and picks it; `/implement` or `/cycle` builds it |
| `status:in-progress` | implementation is active | do not pick it again |
| `status:in-review` | the implementation is in a pull request | do not pick it again; review and CI own the next move |
| `status:blocked` | a named issue or milestone dependency is incomplete | skip it and name the blocker |
| `status:needs-decision` | a product, architecture, security or live-operation decision is required | surface the drafted decision and do not implement it |
| *(none)* | the idea pile — filed but not scheduled | triage/scope it first; don't pick |

Exactly one `status:*` label at a time: every write clears the whole set before adding one, so
the states can't overlap. **No label is a real state**, not a gap — it's every issue still waiting
on a §10.5 certainty call (a review-carved observation, §2; a finding the filer couldn't
confidently route), and that untriaged pile is where triage starts.

**Ranking pickable work** (`/next`): **milestone first**, then **issue number**; only the earliest milestone with dependency-clear ready work is active.

**A closed issue is "done."** `Closes #<n>` closes the issue on merge, and that close *is* the
completion record — there is no `status:done`, because a second source of truth can disagree with
the close and will eventually go stale. The last label the pipeline writes is `status:in-review`;
the merge finishes the story. The pipeline doesn't argue with the close; it lets the close speak.

**A stale-*open* issue may already be shipped.** An umbrella/parent issue's slices often ship
under sibling-numbered PRs that never reference the umbrella's own number — `git log --grep=#<n>`
finds nothing even though the work is done. Before building a pickable-looking issue, trace
whether the described *behavior* already exists in live code (`git log -S"<symbol>"`, read the
actual function) — don't trust issue-number absence in history as proof no work has happened.

- `status:ready` means the issue has no unresolved product decision, names its
  dependencies, identifies concrete files or package boundaries, and has observable
  acceptance criteria that the local gates can prove.
- Later-milestone issues stay `status:blocked` until the preceding milestone's
  retrospective confirms their contract still holds.
- A provider issue must identify both the useful product operation and the oracle
  expectation it adds or changes.

## §2 Labels

- **`finding`** — review debt, diff-coupled; **should trend to empty**. A cycle must not *grow*
  this set as a side effect — escalate only with Brandon's nod (§5).
- **`scout`** — provenance stamp on issues filed by a `/scout` sweep, so their origin stays
  visible later. Additive only; doesn't change routing.

**An issue carved from a review's out-of-scope observation arrives unrouted by design** — no
routing values set. Don't treat that as under-specification: routing is decided by the *picking*
skill at `/cycle` time, from what the diff actually touches, not at filing time.

| Label | Meaning |
| --- | --- |
| `enhancement` | A new product or developer capability. |
| `bug` | Shipped behavior contradicts a reviewed contract; reproduce before fixing. |
| `documentation` | Documentation-only work. |
| `security` | Credentials, auth, data egress, webhook trust, remote writes, money or retention. Read `docs/security.md` first. |
| `area:foundation` | Toolchain, core contracts, mock runtime or workflow infrastructure. |
| `area:github` | GitHub reads, webhooks or explicitly confirmed publication. |
| `area:ai` | OpenAI or Anthropic drafting, review, validation and provenance. |
| `area:billing` | Stripe and sponsor-membership behavior. |
| `area:coverage` | Scenario source, oracle data and Breakscope comparison. |
| `area:operations` | CI, canary runs, release process or future environments. |
| `size:S` | Expected to fit one focused small-model cycle with a narrow diff. |
| `size:M` | Still one cycle, but crosses a package boundary or has a larger contract surface. |

Exactly one `area:*` and one `size:*` label should normally be present. Status labels
describe routing, not severity.

## §3 Routing

- **Model:** Use a smaller fast model for bounded implementation stories with explicit acceptance criteria; use a frontier model for product architecture, security, money, live-provider boundaries, and oracle truth changes.
- **Executor:** **`orchestrator-inline` by default** — the main thread builds directly,
  keeping accumulated context. **Spawn parallel agents only for
  independent mechanical work** (the same change across several files); keep shared-file edits
  (indexes, schema) and the validation gates on the main thread.
- **Reviewer** (`/review` routes by the diff):
  - The **inline correctness pass** — any non-trivial diff. The orchestrator reviews the diff
    itself (logic, edges, error paths, contracts, invariants). The heavyweight `/code-review` is
    **human-triggered** — the loop cannot invoke it; offer it on a large or risky diff and leave
    the call to Brandon.
  - **`/security-review`** — **additionally**, whenever the diff touches Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state, Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys, Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object, Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging, Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics, Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output, Deploying the application or creating hosted infrastructure; no environment is authorized by this repository.
  - A **second-model angle** (a different model family or tier from the implementer) is a cheap
    way to catch same-prior blind spots on a meaty diff.

| Signal | Model |
| --- | --- |
| One package, established contract, deterministic mock and tests | smaller fast model |
| Repeated scenario additions following a reviewed pattern | smaller fast model |
| Product or package architecture, auth, money, live calls or persistence | frontier model and a decision pause |
| Oracle schema or reviewed truth semantics | frontier model |
| Adversarial review of cross-provider or write-boundary work | frontier model |

The default executor remains inline so repository context accumulates. Parallel work is
appropriate only for independent repeated scenario files; shared contracts, indexes,
oracle manifests and final gates stay with the orchestrator.

**Re-verify agent claims:** a spawned agent's "gates green / tests pass" is a *claim*. Re-run the
gates **yourself** before trusting it — a spawned "all green" has failed in a clean shell before.

## §4 Gates

Local, before handing to `/review` or `/done` (never proceed over a red gate):

```
pnpm check
pnpm build
```

- `pnpm check` is the ordered local gate: formatting, lint, strict typechecking and
  credential-free tests. Do not substitute a subset.
- `pnpm build` proves the checked TypeScript contract emits under Node ESM and remains
  a separate CI step.
- `cycle check` must be clean whenever `.cycle/` or rendered skills change. Fix drift
  in config or overlays and re-render; never patch generated skills.
- Green proves internal consistency, not oracle correctness. A source or oracle change
  also requires an explicit scenario-level comparison once that runner exists.
- No test may require ambient credentials or network access. A test that silently uses
  either has violated mock mode even if it passes.

## §5 Judgment calls & autonomy

**Default: run the whole chain unattended** for self-contained, gate-verifiable, non-destructive
stories; Brandon reviews the *result*. **Tier does not gate autonomy** — it only picks the
executor's model. What gates a pause is a **judgment call**.

**Stop and surface — the always-brake set:**
- **Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state** — Brandon wants to *see* these even when the cycle could proceed.
- **Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys** — Brandon wants to *see* these even when the cycle could proceed.
- **Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object** — Brandon wants to *see* these even when the cycle could proceed.
- **Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging** — Brandon wants to *see* these even when the cycle could proceed.
- **Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics** — Brandon wants to *see* these even when the cycle could proceed.
- **Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output** — Brandon wants to *see* these even when the cycle could proceed.
- **Deploying the application or creating hosted infrastructure; no environment is authorized by this repository** — Brandon wants to *see* these even when the cycle could proceed.
- A review finding needs a **design decision**, is **P0**, or **contradicts a memory note**.
- An **implementation choice is genuinely ambiguous** with no obvious default — surface options +
  a recommendation, don't guess.
- **Gates/CI red**, an agent returned **Blocked**, or a spawned "green" that doesn't reproduce.

When the work is well-specified, run it. When in doubt about a *decision*, surface it.

**Findings get actioned, not parked:** `/patch` fix-now is the default (P0/P1/bounded-P2); too-big
= *escalate* to a `finding` issue with Brandon's nod, never a silent defer. An implementer's
own "out of scope, defer to follow-up" tag does **not** override this — if the deferred item would
falsify the story's stated `Acceptance:` criterion, it's in scope regardless of the tag.

**Plans are status updates, not confirmation gates.** Every pipeline skill presents its plan
(`## Plan` / `## Cycle plan` / `## Review plan` / `## Patch plan`) before acting — that's for
visibility, so Brandon can see and redirect. It is **not** a "Proceed?" prompt to wait on.
Present the plan, then continue in the same turn unless the plan *itself* surfaces a judgment call
from this section. This applies whether a skill is driven by `/cycle` or invoked directly.

**The autonomous safe set (`/burndown`).** The unattended grinders operate on the **negation of the
always-brake set**: an item is safe only if it is *none* of the classes above AND is
well-specified, small-to-medium, single-area, and **gate-verifiable** (provable by §4). When
unsure, **exclude and surface** — a mis-graded autonomous merge costs trust; a skipped-safe item
only costs throughput.

- Pure domain contracts, deterministic mocks and issue-sized scenario additions may
  proceed unattended when the issue fully specifies their behavior.
- If an SDK's current documentation contradicts the issue, stop with the exact
  contradiction instead of guessing or preserving an obsolete call shape as product
  code. A historical shape can be proposed as a scenario instead.
- A Breakscope mismatch is evidence to investigate, not permission to change the
  oracle. Re-derive the expectation from product intent and source before choosing
  which repository needs a fix.
- Anything that sends content outward, changes money or mutates GitHub is a human
  decision even when mock tests and CI are green.

## §6 Merge guard

The pipeline pushes + opens PRs. **Auto-merge SAFE stories** (none of §5's always-brake classes,
AND green CI); **a judgment-call story's PR is left open for Brandon's manual merge** —
report "ready for your merge: <url>" + *why* it's gated.

**This repo has no server-side enforcement**, so the **poll-then-merge guard IS the enforcement**.
Never use a fire-and-forget auto-merge flag here — `--auto` merges when the repo's merge
*requirements* are met, and with no branch protection there are none, so it fires immediately with
nothing to wait on. Run the guard in the **background** (the poll takes minutes; a foreground
`sleep` is harness-blocked):

```bash
(until gh pr checks "<pr>" >/dev/null 2>&1; do sleep 30; done; gh pr checks "<pr>" --watch --interval 30 --fail-fast && gh pr merge "<pr>" --squash --delete-branch) &
```

The guard is a client-side *simulation* of branch protection, with a simulation's weaknesses: it
dies with the session, costs polling quota, and the harness can refuse to run it. If this repo ever
gains protection, set `backend_overrides.auto_merge` and delete the guard.

Closing rides on the PR body's `Closes #<n>` keyword — GitHub fires it anywhere in the body
regardless of surrounding prose (§8), so a multi-phase PR must never place that token next to an
issue number it shouldn't close.

**Reading a red gate.** Logs come from `gh run view "<run>" --log`.
`gh run view "<run>" --log-failed`
narrows one run to its failed steps, but it does **not** search backwards: list the runs first
(`gh run list`) and pass the id of the one that actually failed. A red CI is diagnosable, so **"retry and see" is not
an acceptable first move** — read the log, then decide transient-vs-real. §5 still makes an
unexplained red a hard stop.

After a safe merge: **sync local main** (`git checkout main && git fetch origin && git reset --hard
origin/main`) and prune the branch.

**The harness's own auto-mode classifier can independently deny the background merge command**, even
on a safe story with everything above satisfied. That's an environment-level permission gate, not a
pipeline judgment call, and no skill text can route around it. If it fires: report the open,
CI-pending PR and ask Brandon for a one-turn approval to re-run the merge (or to
merge it himself). Don't treat the denial as a §5 pause, and don't retry with `--no-verify` or
other workarounds.

## §7 Tracker mechanics

Routing values are labels on the issue. `gh issue list --state open --json number,title,labels,milestone,url` is the entire read path: it returns
`number`, `title`, `labels`, `milestone` and `url` for every open issue, and because it queries
issues directly it carries open/closed state intrinsically — there is nothing to intersect, and
no way for a stale row to linger.

- **Read the tracker:** `gh issue list --state open --json number,title,labels,milestone,url` (one label: `gh issue list --state open --label "<label>" --json number,title,labels,milestone,url`)
- **Read one issue:** `gh issue view "<n>" --json number,title,state,url,labels,milestone,body`
- **Write a routing value:** `gh issue edit "<n>" --remove-label "status:ready,status:in-progress,status:in-review,status:blocked,status:needs-decision" --add-label "<status:label>"` — clears the other status
  labels and sets this one, in a single call. Non-status labels: `gh issue edit "<n>" --add-label "<label>"` ·
  `gh issue edit "<n>" --remove-label "<label>"`
- **Bulk writes:** an ordinary loop, one call per issue. These are REST calls against the
  5,000/hr core pool, not GraphQL points, so there is nothing to batch around.
- **Issue/PR ops:** `gh issue create --title "<title>" --body "<body>" --label "<label>"` · `gh issue comment "<n>" --body "<text>"` ·
  `gh issue close "<n>"` · `gh pr create --head "<branch>" --base main --title "<title>" --body "<body>"`

A status label that doesn't exist in the repo makes `gh` **fail loudly** — that is the intended
behavior. Create the label rather than working around the error, and never invent a status value
that isn't in the §1 table.

**Unreachable → STOP.** `gh` unauthenticated or offline: say so and stop. Never guess tracker state.

- Milestones use the form `M<n> — <epic>` and are completed in numeric order.
- Each implementation issue names its dependencies explicitly. A dependency on a
  milestone is represented with `status:blocked`, not merely prose.
- The last issue in a milestone triggers the `/cycle next --until-blocked`
  retrospective before any later milestone becomes ready.
- GitHub issues are the live plan. `docs/roadmap.md` records the intended sequence and
  milestone acceptance, but issue status and closure remain authoritative.

## §8 Commit & PR conventions

- **Conventional Commit** (`feat(scope)` / `fix` / `docs` / `chore` / `test`), scoped to the area;
  body names the story. Use the harness's standard identity if it supplies one;
  otherwise omit a co-author trailer rather than inventing an identity.
- **`git add <explicit paths>` — never `-A` / `.`**. Never `--no-verify`; never amend; never
  **force**-push.
- **PR:** base `main`, a "what shipped + which findings were actioned" narrative as the body,
  **with `Closes #<n>`** (closing the issue is the done-signal), title = the Conventional-Commit
  subject. PR bodies end with:
  ```
  🤖 Generated with [Codex CLI](https://developers.openai.com/codex/cli)
  ```
- The `Closes/Fixes/Resolves #N` keyword fires **anywhere** in the body regardless of surrounding
  prose — writing "`Closes #844` is NOT set" still closes #844. When carving one item out of a
  multi-item umbrella issue, never put that token next to the umbrella's number at all, not even to
  deny it — write "part of #844" instead.
- Post a one-line issue comment linking the PR; the narrative lives in the PR body.

## §9 Branch policy

- **Issue work → a feature branch + PR**, always. Never build on `main`; `/implement` branches
  (`git checkout -b <short-slug>`), reusing an epic branch if one exists.
- **Minor tooling / skills / docs edits → straight to `main`**, no branch/PR.
- **Branch off freshly-fetched `origin/main`, not local `main`.** A squash-merge PR is based
  against `origin/main` HEAD, not your local HEAD — if local `main` carries commits never pushed to
  origin, cutting a branch off it silently folds those unpushed commits into your feature's squash
  commit (content survives, but loses its own commit identity). `git checkout main && git fetch
  origin && git reset --hard origin/main` before branching avoids it; the tell after the fact is
  `git pull --ff-only` refusing to fast-forward with local-ahead commits that aren't yours.
- **Local branches don't clean up on their own.** The merge guard deletes the *remote* branch but
  never the local one, and they pile up silently across sessions. Periodically: `git fetch --prune
  origin`, confirm zero open PRs, then bulk `git branch -D` everything but `main` and the current
  branch (`-D` because a squash-merged branch is never a literal ancestor, so plain `-d` refuses
  every one) — safe, since the commits stay recoverable via reflog.

## §10 Filing an issue

Shared by `/scout` (machine-found) and `/intake` (human-described). Both *find or interview, then
file* — neither fixes, branches, or merges.

1. **Dedup first — and a rejection has memory.** Search open issues before filing; a
   near-duplicate gets a comment on the existing issue, not a new one. Then check recently
   *closed* issues too: a twin that was closed without shipping is a decision already made, and
   re-filing it because the code it cites still exists is how a recurring sweep turns the queue
   into a nag. Mention the match in the report; don't re-file it.
2. **The bar is *actionable*.** An issue nobody could pick up and start is noise. If it can't be
   stated as Why / Touches / Acceptance, it isn't ready to file — keep interviewing, or don't file.
3. **Shape it so the smallest human input unlocks it.** Prefer a pre-drafted fix with a
   yes/no decision over an open-ended question. A finding that arrives with the diff already
   written costs Brandon one glance; the same finding as a paragraph costs a work session.
4. **Body format:**
   ```
   **Why:** <the problem, and what's wrong today — with file:line evidence>
   **Touches:** <files / surfaces>
   **Fix (drafted):** <the concrete change — a diff, or the exact edit>
   **Acceptance:** <the observable condition that means it's done>
   ```
   The **Fix** line is mandatory for a machine-found finding (`/scout` read the code; the draft
   is the point) and best-effort for a human-described idea (`/intake` interviews toward it but
   files without it when the idea is scope, not a defect).
5. **Classify by kind, route by certainty.** Kind labels (`bug`, `area:*`, §2's stamps) record
   what you know — set them freely. The `status:*` label is a **certainty call**, made at filing
   time, with three outcomes:
   - **Deterministic** — the fix would be the same no matter who wrote it, and §4's gates can
     prove it → `status:ready`. That is real scheduling: an unattended grinder may
     build it (§5), so the bar is "this exact diff should ship," not "something here should change."
   - **Interpretive** — a judgment call anywhere in it, however small → `status:needs-decision`,
     **with the fix pre-drafted** (rule 3) so the decision costs one glance, not a work session.
   - **Unsure → no status label.** It lands in the untriaged pile (§1) for a human look — the
     filing-time twin of §5's "when unsure, exclude and surface."

   On a §5 brake surface, test the **direction of the change, not the surface it touches**. A
   finding there is deterministic only when it *tightens* — more validation, more redaction,
   stricter gates, fewer accepted inputs — **and** §4's gates can demonstrate both the tightening
   and that nothing legitimate was lost. Anything that loosens, exempts, widens, or re-opens is
   **never** deterministic, however small the diff: certainty and safety are different axes, and
   pickable requires both.

   The second half of that test is load-bearing, because tightening is not automatically safe. A
   redaction rule greedy enough to eat the evidence a validator needs, or a gate strict enough to
   reject legitimate traffic, fails *closed* — which is the quiet direction, and the one that
   hides. Pickable means the gates prove both halves; if they can only prove the tightening, it is
   interpretive.

   A brake entry describing an **irreversible action** rather than a code change — running a
   destructive verb, writing to production — has no direction to test and never becomes pickable.
6. **Budget.** Filing zero is a success. A sweep that files 20 low-grade issues has made the queue
   worse, not better. Cap a focused pass at **3–5** findings; a multi-lens sweep caps *per lens* and
   stays in single digits overall. Rank by (impact × how-actionable) and file only the top ones —
   mention the rest in the report without filing.
