# CLAUDE.md

## What this is

Release Relay is a spec-first reference application for open-source maintainers. It gathers release candidates from GitHub, uses OpenAI and Anthropic adapters to draft and review release communications, and models optional sponsor memberships through Stripe.

The repository is also a synthetic, public canary for Breakscope. Its source should contain realistic third-party API usage with reviewed ground truth, without becoming a pile of disconnected scanner bait.

The deterministic product contracts, mock runtime, provider adapters, billing flows, coverage scenarios, and coverage-oracle comparator are implemented. The application remains offline by default and has no deployed Release Relay runtime. M6, the separately approved Breakscope canary, is the active milestone. The documents under `docs/` remain the product and architecture contract; do not invent behavior that contradicts them.

## Commands

```sh
pnpm install
pnpm check       # format:check -> lint -> typecheck -> test
pnpm build       # emit the root contract and every implemented workspace
pnpm format      # apply Biome formatting
cycle check      # verify rendered workflow files have not drifted
```

Node.js 24 or newer and pnpm 10 are required.

## Current repository shape

- `src/` contains the thin repository-level contract and its test.
- `packages/core` owns domain state, provider ports, draft provenance, and billing contracts.
- `packages/*-integration` contains isolated GitHub, OpenAI, Anthropic, and Stripe adapters with injected-client contract tests; tests never make live calls.
- `packages/mock-runtime` provides the deterministic offline operation ledger.
- `packages/coverage-oracle` validates reviewed manifests and normalized Breakscope reports, then compares them offline.
- `scenarios/` contains reviewed atomic, composed, negative-control, and path-disposition source shapes plus synthetic oracle/report examples.
- `docs/spec.md` is the product source of truth.
- `docs/architecture.md` defines the intended package boundaries before they exist.
- `docs/api-coverage.md` defines useful API-usage coverage.
- `docs/oracle.md` defines reviewed Breakscope expectations.
- `docs/security.md` defines credentials and external-write rules.
- `docs/roadmap.md` maps milestones, completion conditions, and retrospective status.
- `docs/canary-runbook.md` is the non-authorizing M6 preflight and execution handoff.

Keep dependencies one-way: contracts and pure domain packages must not import adapters or applications. A future UI or hosted runtime may live under `apps/*`, but choosing one is still a separate architecture decision.

## Invariants

- **Mock-first and offline by default.** A clean checkout must build and test without credentials, network access, or provider accounts.
- **No real credentials or customer data.** This is a public synthetic repository. Examples use unmistakably fake values, and secret-shaped values must never appear in source, fixtures, logs, snapshots, or issue bodies.
- **External writes require an explicit human action.** Publishing a GitHub release, creating or changing Stripe objects, and any future deployment are separate approval gates. A feature flag alone is not approval.
- **API usage needs a reason.** Ordinary source must serve a documented Release Relay workflow. Historical, adversarial, or negative-control shapes belong in explicitly documented scenario packages.
- **The oracle is reviewed ground truth, not detector output.** Never generate expected observations from the current Breakscope result and commit them as truth. An intentional oracle change must explain the product/source change that justifies it.
- **Keep confidence semantics visible.** Ordinary positive usage belongs in production-shaped `src/` paths. Test, fixture, mock, generated, vendor, and excluded-path scenarios must be intentional because Breakscope treats those paths differently.
- **Live provider calls are a judgment call.** Adding or running a path that sends content to OpenAI, Anthropic, GitHub, or Stripe requires Brandon's explicit approval in that turn.
- **Money and remote mutations fail closed.** Stripe webhooks require signature validation and idempotency. GitHub writes require a preview plus explicit confirmation immediately before the write.

## Engineering conventions

- ESM and strict TypeScript.
- Relative imports include `.js` in TypeScript source that emits for Node.
- Prefer small pure domain functions and narrow adapter interfaces.
- Validate data at every external boundary.
- Keep provider SDK imports inside their adapter package.
- Every behavior change updates its matching `docs/` contract and tests.
- Use current primary documentation through Context7 before adding or changing an SDK, framework, API, or CLI integration.

## Tracker and workflow

GitHub issues are the board. A story is pickable only with `status:ready`; milestones are epics and deliberate `/cycle next --until-blocked` stopping boundaries. Issue bodies state Why, Touches, Fix, Acceptance, dependencies, and non-goals so a smaller model can work without reconstructing product intent.

Run issue work on a feature branch through `/cycle`. The initial bootstrap is the only direct-to-`main` repository creation commit.
