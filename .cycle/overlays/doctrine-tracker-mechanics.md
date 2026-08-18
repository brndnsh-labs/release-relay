- Milestones use the form `M<n> — <epic>` and are completed in numeric order.
- Each implementation issue names its dependencies explicitly. A dependency on a
  milestone is represented with `status:blocked`, not merely prose.
- The last issue in a milestone triggers the `/cycle next --until-blocked`
  retrospective before any later milestone becomes ready.
- GitHub issues are the live plan. `docs/roadmap.md` records the intended sequence and
  milestone acceptance, but issue status and closure remain authoritative.
