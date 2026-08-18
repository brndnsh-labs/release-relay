---
name: done
description: Ship a release-relay story — commit the reviewed work, push, open a PR that Closes #<n>, and (for a safe story) land it through the background poll-then-merge guard; a judgment-call story's PR is left for Brandon's manual merge. Done = the issue closes on merge. Plan-first. Usage `/done #<n>`. Use after /review (+ /patch) pass clean.
---
<!-- cycle:rendered template=skills/done.md.tmpl hash=5b957c131e99 — managed by the-cycle; edit the template, not this file -->

# /done #<n> — ship a story

Goal: commit the reviewed work, push, open a PR that closes the issue, and land it —

auto-merging a safe story through the CI-gated background guard, or leaving a
judgment-call PR for Brandon.

**Shared rules in `.claude/skills/DOCTRINE.md` — read it if not already in context.** This skill
leans on §4 Gates, §5 Judgment calls (the safe-vs-brake split), §6 Merge guard, §7 Tracker
mechanics, §8 Commit & PR conventions, §9 Branch policy. The procedure below is just the ordering.

**Done = the issue closes.** `Closes #<n>` closes it on merge (§1).

## Workflow

1. **Parse the issue ref(s)** — `#<n>`. Several only if one diff genuinely ships them together;
   usually one PR = one issue.
2. **Confirm gates green** (§4) — never `/done` over a red build:
   ```
   pnpm check
   pnpm build
   ```
3. **Confirm findings were actioned, not parked** (§5) — `/patch` fixed every real finding, or
   each was an explicit escalation to a `finding` issue. Never a silent defer.
4. **Survey the diff** — `git status` + `git diff --stat`. Only expected files; flag drift.
5. **Branch check** (§9) — must be on a feature branch, not `main`. If on `main`, stop.
6. **Compose the narrative** — the "what shipped + which findings were actioned + why" summary
   that becomes the **PR body**.
7. **Commit** (§8) — Conventional Commit, explicit paths (never `-A` / `.`), HEREDOC body.
   Use the harness's standard identity if it supplies one; otherwise omit a co-author trailer
   rather than inventing an identity.
8. **Push** — `git push -u origin <branch>`.
9. **Open the PR** (§8) — `gh pr create --head "<branch>" --base main --title "<title>" --body "<body>"` — base `main`, the
   narrative body, **`Closes #<n>`**, the attribution trailer at the end (§8), the
   Conventional-Commit subject as title.
10. **Post a one-line issue comment** linking the PR: `gh issue comment "<n>" --body "<text>"`
11. **Land it — the auto-merge decision (§5 + §6):**
    - **Safe story** — none of §5's always-brake classes (Adding or running a live OpenAI, Anthropic, GitHub, or Stripe call, because it sends data or changes remote state, Adding, exposing, rotating, or changing the handling of credentials, tokens, cookies, webhook secrets, or private keys, Creating or changing a remote GitHub release, Stripe resource, charge, subscription, webhook endpoint, or other external object, Weakening explicit confirmation, current-authorization rechecks, signature validation, idempotency, request bounds, fixed provider hosts, or safe logging, Changing authentication, authorization, payment-state, data-retention, persistent schema, migration, or destructive-data semantics, Changing reviewed oracle truth merely to match current Breakscope output, or generating committed expectations from detector output, Deploying the application or creating hosted infrastructure; no environment is authorized by this repository) **and** green CI →
      run the **poll-then-merge guard in the background** (§6):
      ```bash
      (until gh pr checks "<pr>" >/dev/null 2>&1; do sleep 30; done; gh pr checks "<pr>" --watch --interval 30 --fail-fast && gh pr merge "<pr>" --squash --delete-branch) &
      ```
      After it lands, sync local main and prune the branch, then set
      Status explicitly: `gh issue edit "<n>" --remove-label "status:ready,status:in-progress,status:in-review,status:blocked,status:needs-decision" --add-label "status:in-review"`.
    - **Judgment-call story** → **leave the PR open**, report "ready for your merge: <url>" + *why*
      it's gated. Do NOT auto-merge.
12. **Suggest next:** `/deploy-test`, `/next`, or `/cycle` continues.

## Edge cases

- **Gates red / tests skipped:** STOP — don't paper over it.
- **CI red on the PR:** do NOT merge; surface the failing job (§6 — read the log, don't "retry and
  see"); fix on the branch, push, re-check.
- **Unrelated drift in the diff:** surface it; stage selectively (§8 — never `-A`).
- **The merge command is denied by the harness's own classifier** (§6): report the open, CI-pending
  PR and ask Brandon for a one-turn approval. That's an environment gate, not a §5 pause —
  don't retry with workarounds.
- **Whole epic done:** note it; suggest a docs shipped note if warranted — don't auto-restructure.
- **Issue didn't close after merge** (a `Closes #<n>` typo, or a non-default base): close it
  explicitly — `gh issue close "<n>"`.

- Confirm behavior and its matching `docs/` contract moved together.
- For source or oracle changes, summarize the expectation delta separately from the
  application behavior and name the comparison evidence used.
- Merging does not authorize a live provider call, remote mutation or deployment.
- If the merged issue was the last in its milestone, stop for the milestone
  retrospective before promoting later work.
