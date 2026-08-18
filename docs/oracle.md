# Breakscope scan oracle

## Role

The oracle is a reviewed statement of what Breakscope should learn from a pinned Release Relay revision. It is independent ground truth. It does not execute the detector, call a model, or infer expectations from current output.

An oracle entry describes an expected observation, expected absence, file disposition, or deliberate uncertainty. A repository revision plus oracle version forms a reproducible evaluation input.

## Planned manifest

The first foundation milestone will implement a runtime-validated manifest. The intended conceptual shape is:

```json
{
  "version": 1,
  "revision": "full git commit SHA",
  "scenarios": [
    {
      "id": "github-release-create-direct",
      "purpose": "Publish an approved GitHub release",
      "source": {
        "file": "packages/github-integration/src/publisher.ts",
        "anchor": "release-publish-call"
      },
      "expectations": [
        {
          "outcome": "observation",
          "provider": "github",
          "identifier": "repos.releases.create",
          "evidenceKind": "sdk-call",
          "confidence": "alertable"
        }
      ],
      "rationale": "The official GitHub adapter performs the call after approval.",
      "reviewedBy": "maintainer",
      "reviewedAt": "YYYY-MM-DD"
    }
  ]
}
```

The implemented schema may refine names, but it must preserve the distinctions described here.

## Expectation outcomes

- `observation`: a provider, identifier, source location, evidence kind, and confidence band must match.
- `no-observation`: no observation tied to the named provider or source anchor may exist.
- `demoted`: evidence should exist but remain below the alertable confidence band, such as test-only usage.
- `excluded`: the repository scanner should deliberately skip the file for a named policy reason.
- `uncertain`: evidence is intentionally insufficient for a deterministic conclusion and must not be converted into a confident negative.

An empty result satisfies only `no-observation` or `excluded` when the reason also matches. It never satisfies `uncertain` or `demoted` by accident.

## Stable source identity

Line numbers are useful output but fragile authoring keys. Each scenario therefore includes a unique, provider-neutral anchor near the relevant syntax. The validator resolves the anchor to a current line and ensures it appears exactly once. Anchors must not contain provider names, endpoints, model IDs, or other text that could itself influence detection.

The comparison report records the resolved line range. A source edit that moves a call should update the computed location without requiring a hand-edited numeric line, while a deleted or duplicated anchor fails validation.

## Confidence bands

The oracle describes semantic bands rather than exact floating-point values unless a scenario specifically tests a threshold:

- `alertable`: expected to meet Breakscope's alert confidence requirement when matched to a relevant event;
- `supporting`: useful provider evidence but insufficient alone;
- `demoted`: deliberately weakened because of source position or path; and
- `none`: no observation expected.

Breakscope remains authoritative for its numeric thresholds. A later integration runner maps detector values into these reviewed bands.

## Change-event pairs

Observation coverage and impact correctness are separate. Later oracle versions may attach a minimized historical provider event and one of `affected`, `not_affected`, `uncertain`, or `quarantine`. Those cases must state provenance, literal identifier grounding, expected call sites, and why the repository relation is correct.

The Release Relay repo must not fetch provider changelogs or duplicate Breakscope's normalization pipeline. It supplies stable source and reviewed event pairs; Breakscope owns replay.

## Review workflow

1. Implement or change a documented product or scenario source shape.
2. Draft the oracle change from the source intent before looking at the new detector output where practical.
3. Run manifest validation and the local gates.
4. Compare Breakscope output against the reviewed oracle.
5. Investigate every missing or unexpected result; do not rewrite truth merely to make the comparison green.
6. Record reviewer identity, date, revision, and rationale.

An intentional source and oracle change may ship in the same PR, but the PR narrative must call out the oracle delta separately. Automatically capturing current detector output may produce a diagnostic file, never the committed expectation.

## Reports

The comparator should report:

- expected and observed totals by provider and outcome;
- missing, unexpected, and mismatched observations;
- provider, identifier, evidence-kind, location, and confidence-band accuracy;
- file-disposition accuracy;
- ambiguous and uncertain cases without folding them into negatives;
- the Release Relay commit, oracle version, Breakscope commit, and ruleset version; and
- enough scenario-level detail to reproduce a failure locally.

CI should not depend on a mutable default branch from another repository. Cross-repository evaluations pin both commits. Operational canary runs may follow each default branch but must label results as live observations rather than reproducible CI evidence.
