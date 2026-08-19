# Breakscope scan oracle

## Role

The oracle is a reviewed statement of what Breakscope should learn from a pinned Release Relay revision. It is independent ground truth. It does not execute the detector, call a model, or infer expectations from current output.

An oracle entry describes an expected observation, expected absence, file disposition, or deliberate uncertainty. A repository revision plus oracle version forms a reproducible evaluation input.

## Manifest

The manifest is implemented in `packages/coverage-oracle` (validator + CLI), with a validating example under `scenarios/oracle-v1.example.json`. The intended conceptual shape is:

```json
{
  "version": 1,
  "revision": "full git commit SHA",
  "scenarios": [
    {
      "id": "github-release-create-direct",
      "purpose": "Publish an approved GitHub release",
      "source": {
         "file": "packages/github-integration/src/publish.ts",
         "anchor": "write-adapter-client"
      },
      "expectations": [
        {
          "outcome": "observation",
          "provider": "github",
           "identifier": "repos.createRelease",
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

### Revision pinning

The manifest `revision` must be a full 40-character SHA that exists locally as a commit. The validator checks anchors against the working tree by default. The revision-aware mode (`coverage-oracle validate <manifest> --check-revision`) additionally proves that the declared revision exists locally, that `HEAD` is checked out at that revision, and that every scenario file and anchor exists exactly once in the Git tree at that revision — without fetching remote history. Operational canary scans target the pinned revision, not mutable `main`, and must be run from a checkout of that exact commit.

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

## Normalized scan reports

The normalized scan report is the versioned interchange between Breakscope and the coverage oracle. It is implemented in `packages/coverage-oracle` (validator + comparator + CLI) with a synthetic validating example at `scenarios/report-v2.example.json`. The example is hand-authored and never derived from detector output.

```json
{
  "reportVersion": 2,
  "manifestVersion": 1,
  "releaseRelayRevision": "full git commit SHA",
  "breakscopeRevision": "full git commit SHA",
  "ruleset": "breakscope-ruleset@YYYY-MM-DD",
  "files": [
    { "file": "src/index.ts", "disposition": "scanned" },
    { "file": "scenarios/negative-controls/path-dispositions/src/generated/provider-snapshot.ts", "disposition": "excluded", "reason": "generated source path" }
  ],
  "observations": [
    {
      "file": "packages/github-integration/src/publish.ts",
      "lineStart": 620,
      "lineEnd": 630,
      "provider": "github",
      "identifier": "repos.createRelease",
      "evidenceKind": "sdk-call",
      "confidence": "alertable"
    }
  ]
}
```

- `reportVersion` is `2`; `manifestVersion` remains `1` until the separately versioned oracle manifest changes.
- `releaseRelayRevision` and `breakscopeRevision` are full 40-character SHAs; the comparator requires `releaseRelayRevision` to equal the manifest `revision` (a mismatch fails comparison, because the oracle and the scan must pin the same commit).
- `ruleset` is the Breakscope ruleset identifier; `files` carries per-file dispositions (`scanned` or `excluded` + `reason`); each observation preserves the source-free detector `file`, inclusive `lineStart`–`lineEnd` range, provider, identifier, evidence kind, and reviewed confidence band.
- Normalization validates the snapshot and identity pins, then preserves every validated observation. It does not resolve oracle anchors, demand a reviewed expectation match, discard unrecognized evidence, or generate oracle truth from detector output. The comparator is responsible for classifying an observation as expected or unexpected.
- Input `files` and observations may arrive in any order. Normalized output is sorted deterministically by file and observation location/evidence fields.

### CLI

```sh
coverage-oracle validate <manifest.json> [--check-revision]
coverage-oracle validate-report <report.json>
coverage-oracle compare <manifest.json> <report.json> [--json]
coverage-oracle normalize <manifest.json> <breakscope-snapshot.json> --breakscope-revision <full-sha> [--output <path>]
```

`validate --check-revision` fails if the declared revision is absent locally, if `HEAD` does not equal `manifest.revision`, or if any scenario file or anchor is missing or duplicated in that Git tree; it performs no network fetch. `normalize` validates the versioned source-free Breakscope snapshot (`scenarios/snapshot-v1.example.json`), requires exact repository `brndnsh-labs/release-relay` (ID `1338698763`), `releaseRelayRevision == manifest.revision == HEAD`, `breakscopeRevision` (flag) and `ruleset` (`typescript-deterministic-v5`) identities, `scan.status == completed`, strict per-file dispositions, observation bounds, and exact fields; maps numeric confidence through the reviewed `0.9/0.5` thresholds to `alertable/supporting/demoted` and emits deterministic, lossless `reportVersion:2` JSON (sorted, validated) or fails closed without partial output. The v1 comparator remains available only for validated v1 reports during the staged migration; `coverage-oracle compare` rejects v2 reports with an explicit unsupported-version error until v2 comparison is implemented. `--json` emits a stable, source-free JSON report (keys in manifest/report order, no repository source).

### Runbook

A comparison is reproduced by checking out the pinned Release Relay revision and running `coverage-oracle validate --check-revision` and `coverage-oracle normalize <manifest> <snapshot> --breakscope-revision <sha>`. Comparison of the normalized v2 report is intentionally staged until the v2 comparator ships; do not downgrade or hand-attribute reports to make the v1 comparator accept them. Operational scans pin both repository revisions in their output and must target the reviewed manifest revision, not mutable `main`. CI must not depend on a mutable default branch from another repository. The committed example report and snapshot are synthetic and must never be generated from current detector output.

## Reports

The comparator reports:

- expected and observed totals by provider and outcome;
- missing, unexpected, and mismatched observations;
- provider, identifier, evidence-kind, location, and confidence-band accuracy;
- file-disposition accuracy;
- ambiguous and uncertain cases without folding them into negatives;
- the Release Relay commit, oracle version, Breakscope commit, and ruleset version; and
- enough scenario-level detail to reproduce a failure locally.

CI should not depend on a mutable default branch from another repository. Cross-repository evaluations pin both commits. Operational canary runs may follow each default branch but must label results as live observations rather than reproducible CI evidence.
