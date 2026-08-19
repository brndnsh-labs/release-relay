import { Octokit } from "@octokit/rest";

// The composed deployment's source-gathering module. It owns a cached
// singleton client constructed on first use and reads the comparison range
// for an upcoming release, rather than receiving an injected adapter like
// packages/github-integration. The local binding deliberately reuses the
// `client` name also bound in the drafting module and the sponsor-portal
// class, so name-based attribution has to stay file-scoped. The token is an
// explicit parameter, never read from the environment. This workspace
// compiles only and is never invoked.

export interface ComparisonRange {
  owner: string;
  repo: string;
  base: string;
  head: string;
}

export interface ComparisonSummary {
  commitCount: number;
  commitMessages: string[];
}

let sharedClient: Octokit | undefined;

function clientFor(token: string): Octokit {
  sharedClient ??= new Octokit({ auth: token });
  return sharedClient;
}

// source-reader-compare-client
export async function readComparisonRange(
  token: string,
  range: ComparisonRange
): Promise<ComparisonSummary> {
  const client = clientFor(token);
  const comparison = await client.rest.repos.compareCommits({
    owner: range.owner,
    repo: range.repo,
    base: range.base,
    head: range.head
  });
  const commitMessages = comparison.data.commits.map((commit) => commit.commit.message);
  return { commitCount: comparison.data.commits.length, commitMessages };
}
