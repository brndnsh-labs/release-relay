import assert from "node:assert/strict";
import test from "node:test";
import { assembleCandidates } from "./index.js";
import type { ComparisonResult } from "@release-relay/core";

const baseComparison: ComparisonResult = {
  range: { base: "v0.1.0", head: "main" },
  pullRequests: [],
  issues: [],
  contributors: [],
  priorReleases: []
};

test("empty ranges produce no candidates", () => {
  assert.deepEqual(assembleCandidates(baseComparison), []);
});

test("linked issues are deduplicated behind merged pull requests", () => {
  const candidates = assembleCandidates({
    ...baseComparison,
    pullRequests: [
      {
        sourceIdentity: "pull/2",
        url: "https://github.com/example/project/pull/2",
        title: "Fix the linked issue",
        merged: true,
        reverted: false,
        linkedIssueIdentities: ["issue/9"]
      }
    ],
    issues: [
      {
        sourceIdentity: "issue/9",
        url: "https://github.com/example/project/issues/9",
        title: "The linked issue",
        closed: true,
        linkedPullRequestIdentities: ["pull/2"]
      },
      {
        sourceIdentity: "issue/10",
        url: "https://github.com/example/project/issues/10",
        title: "Standalone issue",
        closed: true,
        linkedPullRequestIdentities: []
      }
    ]
  });

  assert.deepEqual(
    candidates.map(({ sourceIdentity, included, order }) => ({
      sourceIdentity,
      included,
      order
    })),
    [
      { sourceIdentity: "issue/10", included: true, order: 0 },
      { sourceIdentity: "pull/2", included: true, order: 1 }
    ]
  );
});

test("reverted work is retained as excluded and prior releases do not become candidates", () => {
  const candidates = assembleCandidates({
    ...baseComparison,
    pullRequests: [
      {
        sourceIdentity: "pull/3",
        url: "https://github.com/example/project/pull/3",
        title: "Reverted change",
        merged: true,
        reverted: true,
        linkedIssueIdentities: [],
        included: true,
        maintainerAnnotation: "Reverted before release"
      }
    ],
    priorReleases: [
      {
        tag: "v0.1.0",
        url: "https://github.com/example/project/releases/tag/v0.1.0",
        title: "Prior release"
      }
    ],
    contributors: [
      { identity: "contributor-a", url: "https://github.com/contributor-a" },
      { identity: "contributor-b", url: "https://github.com/contributor-b" }
    ]
  });

  assert.deepEqual(candidates, [
    {
      sourceIdentity: "pull/3",
      sourceUrl: "https://github.com/example/project/pull/3",
      title: "Reverted change",
      included: false,
      order: 0,
      maintainerAnnotation: "Reverted before release"
    }
  ]);
});

test("missing optional metadata and maintainer disposition are preserved", () => {
  const candidates = assembleCandidates({
    ...baseComparison,
    pullRequests: [
      {
        sourceIdentity: "pull/20",
        url: "https://github.com/example/project/pull/20",
        title: "Optional metadata omitted",
        merged: true,
        reverted: false,
        linkedIssueIdentities: [],
        included: false,
        maintainerAnnotation: "Hold for next release"
      }
    ],
    issues: [
      {
        sourceIdentity: "issue/2",
        url: "https://github.com/example/project/issues/2",
        title: "Closed issue",
        closed: true,
        linkedPullRequestIdentities: [],
        maintainerAnnotation: "Include as a note"
      },
      {
        sourceIdentity: "issue/1",
        url: "https://github.com/example/project/issues/1",
        title: "Open issue",
        closed: false,
        linkedPullRequestIdentities: []
      }
    ]
  });

  assert.deepEqual(candidates, [
    {
      sourceIdentity: "issue/2",
      sourceUrl: "https://github.com/example/project/issues/2",
      title: "Closed issue",
      included: true,
      order: 0,
      maintainerAnnotation: "Include as a note"
    },
    {
      sourceIdentity: "pull/20",
      sourceUrl: "https://github.com/example/project/pull/20",
      title: "Optional metadata omitted",
      included: false,
      order: 1,
      maintainerAnnotation: "Hold for next release"
    }
  ]);
});
