import { Octokit } from "@octokit/rest";

// A maintainer-facing CLI helper that previews upcoming release contents by
// reading a comparison range directly through the official SDK, rather than
// through Release Relay's injected adapter (packages/github-integration).
// The token is an explicit parameter, never read from the environment: this
// workspace compiles only and is never invoked, so it must not model
// credential loading.

export interface UpcomingReleasePreview {
  commitCount: number;
  commitMessages: string[];
}

// maintainer-cli-read-client
export async function previewUpcomingRelease(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<UpcomingReleasePreview> {
  const octokit = new Octokit({ auth: token });
  const comparison = await octokit.rest.repos.compareCommits({
    owner,
    repo,
    base,
    head
  });
  const commitMessages = comparison.data.commits.map((commit) => commit.commit.message);
  return { commitCount: comparison.data.commits.length, commitMessages };
}
