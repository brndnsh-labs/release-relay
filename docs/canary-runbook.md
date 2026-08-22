# Breakscope canary runbook

## Status and authority

This document prepares M6; it does not authorize an installation change, repository-selection change, production replay, deployment, database write, or live scan. Before any such action, re-run the read-only preflight below, present the exact resolved values and action, and obtain a fresh explicit approval in that turn.

The first canary is intentionally narrow:

| Field | Required value |
| --- | --- |
| GitHub App | `breakscope`, owned by `brndnsh-labs` |
| Installation account | `brndnsh-labs` organization |
| Included repository | `brndnsh-labs/release-relay` only; GitHub repository ID `1338698763` |
| Repository visibility | Public |
| Breakscope environment | Production at `https://breakscope.dev`, hosted by the `breakscope` stack on `docker04` |
| GitHub permissions | Metadata read, Contents read, Issues write |
| Subscribed events | `push`, `repository`; installation events remain automatic |
| Scan path | Breakscope's ordinary single-archive repository-worker path |
| Release Relay revision | Full reviewed `manifest.revision` SHA; it must identify the complete M5 corpus and be resolved and recorded at execution time |
| Breakscope revision | Full deployed image revision resolved from the running container at execution time |
| Ruleset | Exact ruleset stored on the completed scan; the 2026-08-19 reference was `typescript-deterministic-v5` |
| Write posture | `ISSUE_WRITES_ENABLED=false`, `MANUAL_ALERT_APPROVAL_REQUIRED=true`, and Release Relay absent from `CANARY_REPOSITORY_IDS` |

The App's public permission includes Issues write because that is the reviewed Breakscope App contract. Read-only safety for this exercise therefore comes from the deployed write gates and canary allowlist, all of which must be checked again immediately before the repository-selection action and after the scan.

## Known blockers from the 2026-08-19 preparation pass

Do not request the execution approval until all are cleared:

1. [Breakscope #76](https://github.com/brndnsh-labs/Breakscope/issues/76) is approved and the `snapshot-v1` export contract is implemented; `coverage-oracle normalize` (`packages/coverage-oracle/src/normalize.ts`, `scenarios/snapshot-v1.example.json`) validates it offline and maps it to lossless `reportVersion:2`. Do not substitute ad hoc production SQL, retain repository source, or invent file dispositions from missing rows.
2. `GET https://breakscope.dev/api/health/deep` returned `503` with `deadLetters: false`. `bin/breakscope-admin status` reported 62 `repository.scan.dead-letter` rows, only one with a replay marker. The dry-run replay plan listed 61 unreplayed jobs. [Breakscope #77](https://github.com/brndnsh-labs/Breakscope/issues/77) owns diagnosis and the separately approved bounded replay/disposition; do not roll that production write into the canary approval.
3. The ordinary authenticated `gh` token cannot enumerate the App installation's selected repositories. Verify repository selection in the GitHub installation settings or through a correctly scoped App/user token without exposing that token. Determine whether Release Relay is already selected before proposing any mutation.
4. `scenarios/oracle-v2.example.json` is pinned to the complete reviewed M5 corpus revision `c3f7cef9fe58df6d790a87a2c7fb05634cf85ee0` (every scenario file and anchor resolves at that commit; `coverage-oracle validate scenarios/oracle-v2.example.json --source-root <path> --check-revision` proves the pin without network access). Verify the target remains the reviewed manifest revision, not mutable `main`, before a canary target is chosen.

These are live observations, not permanent facts. The later execution pass must refresh them.

## Read-only preflight

Run every command from a clean checkout. Save only non-secret output.

### 1. Pin Release Relay and verify its gates

```sh
git fetch origin
git status --short --branch
node -e 'const m=require("./scenarios/oracle-v2.example.json"); console.log(m.revision)'
git cat-file -e "$(node -e 'const m=require("./scenarios/oracle-v2.example.json"); process.stdout.write(m.revision)')^{commit}"
git rev-parse HEAD
gh run list --branch main --limit 5
pnpm check
pnpm build
cycle check
```

Record the full manifest revision and verify the complete reviewed corpus from that Git tree via `coverage-oracle validate scenarios/oracle-v2.example.json --source-root <path> --check-revision` (fails if the revision is missing locally, if `HEAD` does not match it, or if any file/anchor is missing/duplicated at that revision, without network fetch). The operational scan must target exactly that SHA even when `main` has moved; never rewrite the reviewed oracle from the scan result.

### 2. Verify the GitHub App contract

From a clean Breakscope checkout:

```sh
pnpm github-app:preflight
```

Every automated line must be `PASS`. Manually verify the repository-selection mode, webhook URL/content type, OAuth callback, and setup URL against Breakscope's checked-in `config/github-app.expected.json`. Verify the webhook secret matches without printing or copying either value.

In GitHub's `brndnsh-labs` installation settings, record whether `release-relay` is already selected. Do not add or remove a repository during preflight.

### 3. Pin Breakscope production and prove write safety

```sh
curl -sS -i https://breakscope.dev/api/health/deep
bin/breakscope-admin status
bin/breakscope-admin accounts --limit 500
ssh docker04-admin 'sudo -n docker inspect breakscope-worker-repository --format "{{json .Config.Labels}}"'
ssh docker04-admin 'sudo -n docker inspect breakscope-worker-repository --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -E "^(ISSUE_WRITES_ENABLED|MANUAL_ALERT_APPROVAL_REQUIRED|CANARY_REPOSITORY_IDS|PRIVATE_REPOSITORIES_ENABLED)="'
```

Stop unless deep health is HTTP 200 with every check true, both workers are fresh, there are no unexplained or unreplayed dead letters, the deployed image revision is a full known Breakscope commit with green CI, issue writes are false, manual approval is true, and Release Relay is not allowlisted for issue creation. Do not include any other environment values in evidence.

### 4. Resolve the exact proposed action

Present one of these, with all values filled in:

- `already selected`: no GitHub configuration mutation; await or explicitly trigger only a reviewed ordinary repository sync/scan path;
- `add one selected repository`: in the existing `brndnsh-labs` installation, add only `brndnsh-labs/release-relay` without removing current selections or switching to all repositories; or
- `new installation required`: stop and draft a separate installation plan. Do not infer authorization from this runbook.

The proposal must name the acting GitHub account, App, installation account, target repository and ID, current selection state, exact UI/API action, reviewed manifest/Release Relay SHA, deployed Breakscope SHA, ruleset, health result, write flags, inclusions, exclusions, evidence location, and rollback.

## Fresh approval stop

Stop here. Ask Brandon to approve the exact repository-selection action and first scan. Approval from an earlier planning, code, tracker, merge, or deployment turn does not carry forward.

## Execution after approval

1. Recheck the resolved values and safety flags immediately before the action.
2. If needed, change only the existing installation's selected repository set by adding `brndnsh-labs/release-relay`. Do not remove other repositories, select all repositories, change permissions/events, alter secrets, deploy Breakscope, or enable issue writes.
3. Confirm the signed `installation_repositories` webhook was delivered and the ordinary `installation.sync` path discovered the repository.
4. Await one normal repository-worker archive scan of the pinned Release Relay SHA. Do not add a per-file read, create a synthetic push, or replay unrelated jobs to force it.
5. Export only the reviewed source-free snapshot. Record the Release Relay SHA, deployed Breakscope SHA, ruleset, scan outcome, file dispositions, and safe observation metadata. Retain no archive, source, snippets, credentials, signed URLs, prompts, raw model output, or database dump.
6. Keep the tool and manifest checkout on current `main`, then create a separate clean, detached source checkout at the reviewed revision. Do not copy the manifest or tooling into that source checkout. Construct and validate the normalized v2 report against that explicit source root:

   ```sh
   source_parent="$(mktemp -d)"
   source_root="$source_parent/release-relay"
   release_relay_revision="$(node -e 'const m=require("./scenarios/oracle-v2.example.json"); process.stdout.write(m.revision)')"
   git worktree add --detach "$source_root" "$release_relay_revision"
   coverage-oracle validate scenarios/oracle-v2.example.json --source-root "$source_root" --check-revision
   coverage-oracle normalize scenarios/oracle-v2.example.json <breakscope-snapshot.json> --breakscope-revision <full-sha> --source-root "$source_root" --output <normalized-report.json>
   coverage-oracle validate-report <normalized-report.json>
   coverage-oracle compare scenarios/oracle-v2.example.json <normalized-report.json> --source-root "$source_root"
   git worktree remove "$source_root"
   rmdir "$source_parent"
   ```

7. Record matching, missing, unexpected, mismatched, unresolved, limited, and operational-failure outcomes distinctly. A mismatch becomes an investigation; it never changes the oracle automatically.
8. Recheck deep health and the write flags. Confirm no GitHub issue was created and no production configuration changed beyond the specifically approved repository selection.

## Evidence and retention

The retained evidence may contain only both full commit SHAs, ruleset, timestamps, non-secret App configuration, repository identity, scan/monitoring outcome, aggregate comparison results, and the normalized source-free observation metadata accepted by the report schema. Store the bounded report in the location approved during the execution preflight and state its expiry. Never commit a production-derived report as reviewed oracle truth.

## Rollback

If repository selection was changed and the scan path is unhealthy, remove only `brndnsh-labs/release-relay` from the existing installation's selected repositories after a separately confirmed rollback action. Do not uninstall the App or disturb other selected repositories. Verify the removal webhook, repository inactivity, worker health, and unchanged write gates. Historical safe metadata follows Breakscope's existing retention policy; do not delete production rows ad hoc.
