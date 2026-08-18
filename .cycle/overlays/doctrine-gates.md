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
