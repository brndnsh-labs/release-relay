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
