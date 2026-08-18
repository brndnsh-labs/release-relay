- Read the matching `docs/` contract before editing; if the issue contradicts it, stop
  and surface the mismatch.
- Any SDK, API, framework or CLI work starts by fetching current primary documentation
  through Context7.
- A provider source change states its product purpose and updates or adds the reviewed
  oracle expectation in the same PR when the expectation changes.
- Keep ordinary positive API usage in production-shaped `src/` paths. Use special path
  names only when their confidence or exclusion behavior is the scenario under test.
- Run `cycle check` after changing `.cycle/`; generated skill trees are never edited.
