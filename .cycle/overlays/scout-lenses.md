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
