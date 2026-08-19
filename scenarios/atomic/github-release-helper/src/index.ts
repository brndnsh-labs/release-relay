import { Octokit } from "@octokit/rest";

// A maintainer helper that prepares (but never sends) a create-release call
// through a class-held client field, varying the client-construction shape
// from the function-local client in scenarios/atomic/github-maintainer-cli
// and from the injected-client pattern in packages/github-integration. This
// workspace compiles only and is never invoked or given a real token.

export interface DraftReleaseRequest {
  owner: string;
  repo: string;
  tagName: string;
  title: string;
  body: string;
}

export class ReleaseHelper {
  private readonly client: Octokit;

  constructor(token: string) {
    this.client = new Octokit({ auth: token });
  }

  // release-helper-write-client
  prepareRelease(request: DraftReleaseRequest): Promise<{ data: unknown }> {
    return this.client.rest.repos.createRelease({
      owner: request.owner,
      repo: request.repo,
      tag_name: request.tagName,
      name: request.title,
      body: request.body,
      draft: true
    });
  }
}
