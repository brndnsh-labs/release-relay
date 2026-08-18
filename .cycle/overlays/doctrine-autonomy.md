- Pure domain contracts, deterministic mocks and issue-sized scenario additions may
  proceed unattended when the issue fully specifies their behavior.
- If an SDK's current documentation contradicts the issue, stop with the exact
  contradiction instead of guessing or preserving an obsolete call shape as product
  code. A historical shape can be proposed as a scenario instead.
- A Breakscope mismatch is evidence to investigate, not permission to change the
  oracle. Re-derive the expectation from product intent and source before choosing
  which repository needs a fix.
- Anything that sends content outward, changes money or mutates GitHub is a human
  decision even when mock tests and CI are green.
