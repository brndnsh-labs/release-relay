# Release Relay

Release Relay is a spec-first workspace for open-source maintainers to assemble and publish releases. It contains strict domain contracts, deterministic mocks, and isolated GitHub, OpenAI, Anthropic, and Stripe adapters for the documented workflows.

This repository has a second, explicit purpose: it is a synthetic public canary for [Breakscope](https://breakscope.dev). The application should contain realistic third-party integration code whose expected scan results are reviewed and versioned. Product usefulness comes first; artificial API shapes are isolated as documented coverage scenarios.

## Status

Milestones M1 through M5 are implemented. The repository builds and tests the core workflow, provider boundaries, sponsor-membership model, reviewed scan corpus, and offline coverage-oracle comparator. Nothing calls a live provider during normal development or CI, and Release Relay has no deployed application runtime.

The current implementation includes:

- versioned product, architecture, security, coverage, and oracle contracts;
- strict TypeScript packages for the domain, mock runtime, and provider integrations;
- atomic, composed, negative-control, and path-disposition scan scenarios;
- an offline validator and comparator for pinned normalized Breakscope reports;
- a repository-specific [the-cycle](https://github.com/brndnsh-labs/the-cycle) workflow;
- M6 operational work that remains behind explicit Breakscope permission and production-health gates.

## Development

Prerequisites are Node.js 24 or newer, pnpm 10, git, and an authenticated `gh` CLI for tracker operations.

```sh
pnpm install
pnpm check
pnpm build
cycle check
```

`pnpm check` runs formatting, linting, typechecking, and tests. All checks are credential-free and offline after dependencies are installed.

## Read next

- [Product specification](docs/spec.md)
- [Architecture](docs/architecture.md)
- [API coverage strategy](docs/api-coverage.md)
- [Scan oracle](docs/oracle.md)
- [Security model](docs/security.md)
- [Roadmap](docs/roadmap.md)
- [Breakscope canary runbook](docs/canary-runbook.md)
- [Manual model-evaluation procedure](docs/model-evaluation.md)

Repository source, examples, and test data are synthetic. Never add real credentials, private repository contents, customer information, or live billing data.
