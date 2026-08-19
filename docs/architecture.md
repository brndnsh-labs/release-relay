# Architecture

## Current state

Only a thin TypeScript bootstrap exists. The package layout below is a target contract for incremental issues, not an instruction to scaffold everything at once. A package should appear only when a story needs it.

## Target topology

```text
apps/
  web/                 maintainer and supporter HTTP surfaces
  worker/              background reads, drafts, and projected webhook work
packages/
  core/                strict domain values, state transitions, ports
  mock-runtime/        deterministic offline adapters and operation ledger
  github-integration/  GitHub read and explicitly approved write adapter
  openai-integration/  structured release-draft adapter
  anthropic-integration/ structured review and alternate-draft adapter
  stripe-integration/  Checkout, portal, products, and signed webhooks
  coverage-oracle/     scenario schema, validator, and comparison report
scenarios/
  atomic/              one reviewed integration shape per small workspace
  composed/            realistic applications combining several adapters
  negative-controls/   unrelated and deliberately non-attributable usage
```

`scenarios/` is intentionally not called `fixtures/` or `tests/`: ordinary positive scenarios should look like ordinary source to Breakscope. Scenarios that specifically test test-path demotion or excluded directories use those names locally and declare that expectation in the oracle.

## Dependency direction

`core` imports nothing from other workspace packages. Adapters import `core`. Applications import `core` and selected adapters. `coverage-oracle` may read repository files and manifest data but cannot be imported by application runtime code. Scenario workspaces may import published SDKs and local helper packages but never application secrets.

Circular workspace dependencies are prohibited. Provider SDK types must not leak into `core` contracts because that would make provider replacement and mock mode dependent on a live SDK.

## Runtime modes

### Mock mode

Mock mode is the default and must cover every product workflow. It uses deterministic provider responses, stable clocks and identifiers, and an append-only operation ledger. It performs no DNS lookups and needs no environment variables.

The mock runtime is composed from the core ports and accepts scripted success,
refusal, and failure outcomes for boundary tests. Its ledger contains operation
IDs, provider names, operation names, statuses, safe resource IDs, error classes,
and deterministic timestamps only.

### Live mode

Live mode is a future development capability, not a production environment. It is entered through explicit configuration and provider-specific credentials. Read and write permissions remain distinct. Enabling live reads must not enable GitHub publication, Stripe mutation, or content-bearing AI calls automatically.

There is no silent fallback from a failed live call to mock success. The UI and operation result must say which mode produced the data.

## Core ports

The intended domain ports are narrow and operation-oriented:

- `GitHubReader` reads repository identity, comparison ranges, pull requests, issues, contributors, and releases.
- `GitHubPublisher` previews and publishes one approved release using an idempotency key.
- `ReleaseDrafter` produces a validated structured draft from bounded candidate material.
- `DraftReviewer` returns cited review findings or an alternate structured draft.
- `SponsorBilling` manages tier synchronization and creates hosted Checkout or portal sessions.
- `StripeWebhookProjector` verifies and projects signed events idempotently.
- `OperationLedger` records safe metadata about attempted and completed external operations.

Ports should express product operations, not mirror entire vendor SDK clients.
Operation results are limited to `completed`, `duplicate`, `refused`, and `failed`,
with an application operation ID and safe error class rather than raw provider data.
Hosted Checkout or portal sessions do not imply membership state; membership is
projected only from verified webhook events.

## State and hand-off

Initial stories use in-memory repositories and synchronous orchestration so the domain contract can stabilize. A future hosted persistence decision is separate. If durable background work is added, the hand-off from an accepted request to a worker must be transactional and idempotent; the web process must not claim success for work it merely attempted to enqueue.

Every external operation receives an application-generated operation ID. Retries reuse it. Adapter results distinguish `completed`, `duplicate`, `refused`, and `failed`; a timeout is not proof that a remote write did not occur.

## Provider boundaries

Each provider package owns SDK construction, raw response validation, error classification, redaction, and mapping to core values. Environment reads occur at the composition root and typed configuration is passed inward.

The GitHub read adapter uses the registered Octokit REST methods for repository,
comparison, pull request, issue, and release reads. Its test seam
accepts an injected client; only explicit live composition roots construct
Octokit. In live mode the `compareCommits` response is the authoritative range
boundary: a closed pull request becomes a candidate only when it is merged and
its merge commit SHA appears in the comparison's commits, linked issues are
derived from closing keywords in retained pull request bodies, reverted work is
marked from GitHub's `Reverts owner/repo#N` body pattern, and contributors are
the range's commit authors rather than the repository's all-time list. An
identical or commit-less range selects no candidates; prior releases stay
separated as context. Known bounded ceilings: the unpaginated comparison caps
`commits` at 250, and pull request and linked-issue discovery is bounded by the
adapter's page limit over `pulls.list` and `issues.listForRepo` sorted by
recency — a merged pull request outside that recency window is conservatively
excluded, and a linked issue outside the issues window is omitted from the
issue summaries while the retained pull request still carries its link identity
(documented fallbacks, never silent). A comparison response that claims commits
but carries no parseable commit list, or whose repository identity cannot be
established from its URL, is rejected as invalid input rather than treated as
an empty range.
The separate GitHub write adapter uses `repos.get` for the current publication
authorization check, `repos.getReleaseByTag` for reconciliation, and
`repos.createRelease` only after preview hash, confirmation, expiry, and access
checks pass.

Raw HTTP variants exist only where they represent realistic product code or a declared coverage scenario. No adapter accepts an arbitrary caller-provided base URL. Webhook handlers receive raw bytes for signature verification before parsing.

## Human confirmation boundary

Draft creation is reversible but still may send content outside the process. GitHub publication and Stripe mutation are remote writes. The application must render the exact operation and re-check a short-lived confirmation immediately before invoking a writer port. Background retries may repeat an already-confirmed operation ID but may not broaden or alter it.

## Observability

Logs contain operation IDs, provider names, safe resource IDs, states, durations, and error classes. They do not contain credentials, complete prompts, GitHub bodies, webhook payloads, Checkout URLs, or raw provider errors.

Mock mode exposes its operation ledger in tests and development UI so acceptance criteria can prove which operations would have happened.

## Evolution rules

- Add one package with the first story that needs it.
- Add one integration shape at a time and update the oracle intentionally.
- Keep domain tests provider-independent and adapter tests at the boundary.
- Treat a framework, database, queue, or deployment topology as an explicit architecture decision rather than incidental scaffolding.
- Preserve tagged repository revisions once Breakscope uses them as canary baselines.
