import { Octokit } from "@octokit/rest";

// A same-provider negative: a maintainer utility that calls the official
// GitHub SDK for an operation outside Release Relay's documented product
// workflow (repository identity, comparisons, pull requests, issues,
// contributors, releases, and the confirmed release write). Listing a
// user's public gists is real, correctly attributed GitHub API usage that
// should not be conflated with the release-publication call site in
// scenarios/atomic/github-release-helper. This workspace compiles only and
// is never invoked or given a real token.

// unrelated-negative-read-client
export async function listMaintainerGists(
  token: string,
  username: string
): Promise<{ data: unknown }> {
  const octokit = new Octokit({ auth: token });
  return octokit.rest.gists.listForUser({ username });
}
