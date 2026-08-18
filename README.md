# Release Relay

Release Relay is a planned workspace for open-source maintainers to assemble and publish releases. It will collect merged work from GitHub, use OpenAI and Anthropic to draft and review release communications, and manage optional sponsor memberships through Stripe.

This repository has a second, explicit purpose: it is a synthetic public canary for [Breakscope](https://breakscope.dev). The application should contain realistic third-party integration code whose expected scan results are reviewed and versioned. Product usefulness comes first; artificial API shapes are isolated as documented coverage scenarios.

## Status

Specification and work planning only. No application has been implemented and nothing calls a live provider.

The current commit establishes:

- the product, architecture, security, and coverage contracts;
- a minimal strict-TypeScript toolchain with meaningful gates;
- a repository-specific [the-cycle](https://github.com/brndnsh-labs/the-cycle) workflow;
- milestone-sized implementation work suitable for bounded autonomous cycles.

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

Repository source, examples, and test data are synthetic. Never add real credentials, private repository contents, customer information, or live billing data.
