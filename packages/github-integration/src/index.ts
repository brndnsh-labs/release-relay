import type {
  CandidateItem,
  ComparisonResult,
  IssueSummary,
  PullRequestSummary
} from "@release-relay/core";

function compareIdentity(
  left: { sourceIdentity: string },
  right: { sourceIdentity: string }
): number {
  if (left.sourceIdentity < right.sourceIdentity) return -1;
  if (left.sourceIdentity > right.sourceIdentity) return 1;
  return 0;
}

function candidateFromSource(
  source: PullRequestSummary | IssueSummary,
  included: boolean,
  order: number
): CandidateItem {
  return {
    sourceIdentity: source.sourceIdentity,
    sourceUrl: source.url,
    title: source.title,
    included,
    order,
    ...(source.maintainerAnnotation === undefined
      ? {}
      : { maintainerAnnotation: source.maintainerAnnotation })
  };
}

export function assembleCandidates(
  comparison: ComparisonResult
): readonly CandidateItem[] {
  const mergedPullRequests = comparison.pullRequests.filter(
    (pullRequest) => pullRequest.merged
  );
  const mergedPullRequestIdentities = new Set(
    mergedPullRequests.map((pullRequest) => pullRequest.sourceIdentity)
  );
  const linkedIssueIdentities = new Set(
    mergedPullRequests.flatMap((pullRequest) => pullRequest.linkedIssueIdentities)
  );

  const pullRequestCandidates = mergedPullRequests.map((pullRequest) =>
    candidateFromSource(
      pullRequest,
      pullRequest.reverted ? false : (pullRequest.included ?? true),
      0
    )
  );
  const issueCandidates = comparison.issues
    .filter((issue) => {
      if (!issue.closed || linkedIssueIdentities.has(issue.sourceIdentity))
        return false;
      return !issue.linkedPullRequestIdentities.some((identity) =>
        mergedPullRequestIdentities.has(identity)
      );
    })
    .map((issue) => candidateFromSource(issue, issue.included ?? true, 0));

  return [...pullRequestCandidates, ...issueCandidates]
    .sort(compareIdentity)
    .map((candidate, order) => ({ ...candidate, order }));
}

export * from "./live.js";
export * from "./publish.js";
