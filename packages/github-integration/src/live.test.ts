import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryRef } from "@release-relay/core";
import { createGitHubReader, type GitHubApi, type GitHubReadScope } from "./live.js";

const repository: RepositoryRef = { owner: "example", name: "project" };

const RANGE_SHA_A = "a".repeat(40);
const RANGE_SHA_B = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);

function response(data: unknown) {
  return Promise.resolve({ data });
}

function compareResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "ahead",
    total_commits: 2,
    html_url: `https://github.com/${repository.owner}/${repository.name}/compare/v1.0.0...main`,
    commits: [
      {
        sha: RANGE_SHA_A,
        author: { login: "range-author", html_url: "https://github.com/range-author" }
      },
      { sha: RANGE_SHA_B }
    ],
    ...overrides
  };
}

function mergedPull(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    html_url: "https://github.com/example/project/pull/1",
    title: "Merged in-range change",
    merged_at: "2026-08-18T00:00:00Z",
    merge_commit_sha: RANGE_SHA_A,
    body: "Closes #3",
    ...overrides
  };
}

function apiWith(overrides: Partial<GitHubApi> = {}): GitHubApi {
  return {
    getRepository: () =>
      response({
        id: 42,
        name: "project",
        html_url: "https://github.com/example/project",
        owner: { login: "example" }
      }),
    compareCommits: () => response(compareResponse()),
    listPullRequests: () =>
      response([
        mergedPull(),
        mergedPull({
          number: 2,
          html_url: "https://github.com/example/project/pull/2",
          title: "Unrelated old merged change",
          merge_commit_sha: OTHER_SHA
        }),
        mergedPull({
          number: 6,
          html_url: "https://github.com/example/project/pull/6",
          title: "Closed but never merged",
          merged_at: undefined,
          merge_commit_sha: RANGE_SHA_B
        })
      ]),
    listIssues: () =>
      response([
        {
          number: 3,
          html_url: "https://github.com/example/project/issues/3",
          title: "Linked closed issue",
          state: "closed"
        },
        {
          number: 4,
          html_url: "https://github.com/example/project/issues/4",
          title: "Unlinked closed issue",
          state: "closed"
        },
        {
          number: 5,
          html_url: "https://github.com/example/project/pull/5",
          title: "Pull request returned by issue endpoint",
          pull_request: {}
        }
      ]),
    listReleases: () =>
      response([
        {
          tag_name: "v1.0.0",
          html_url: "https://github.com/example/project/releases/tag/v1.0.0"
        }
      ]),
    ...overrides
  };
}

async function compareWith(api: GitHubApi, scope: GitHubReadScope = { repository }) {
  const reader = createGitHubReader(api, scope);
  return reader.compare({
    operationId: "compare-1",
    repository,
    range: { base: "v1.0.0", head: "main" }
  });
}

test("retains only merged pull requests evidenced by the comparison range", async () => {
  const result = await compareWith(apiWith());
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value.pullRequests, [
    {
      sourceIdentity: "pull/1",
      url: "https://github.com/example/project/pull/1",
      title: "Merged in-range change",
      merged: true,
      reverted: false,
      linkedIssueIdentities: ["issue/3"]
    }
  ]);
});

test("derives linked issues only from retained pull request bodies", async () => {
  const result = await compareWith(apiWith());
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value.issues, [
    {
      sourceIdentity: "issue/3",
      url: "https://github.com/example/project/issues/3",
      title: "Linked closed issue",
      closed: true,
      linkedPullRequestIdentities: ["pull/1"]
    }
  ]);
});

test("grounds contributors in range commits, not the all-time contributor list", async () => {
  const api = apiWith({
    compareCommits: () =>
      response(
        compareResponse({
          commits: [
            {
              sha: RANGE_SHA_A,
              author: { login: "alpha", html_url: "https://github.com/alpha" }
            },
            {
              sha: RANGE_SHA_B,
              author: { login: "alpha", html_url: "https://github.com/alpha" }
            },
            {
              sha: "d".repeat(40),
              author: { login: "beta", html_url: "https://github.com/beta" }
            },
            { sha: "e".repeat(40), author: {} }
          ]
        })
      )
  });
  const result = await compareWith(api);
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value.contributors, [
    { identity: "alpha", url: "https://github.com/alpha" },
    { identity: "beta", url: "https://github.com/beta" }
  ]);
});

test("keeps prior releases as context that can never become candidates", async () => {
  const result = await compareWith(apiWith());
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value.priorReleases, [
    {
      tag: "v1.0.0",
      url: "https://github.com/example/project/releases/tag/v1.0.0",
      title: "v1.0.0"
    }
  ]);
});

test("an identical range yields no candidates despite repository-wide content", async () => {
  const calls: string[] = [];
  const api = apiWith({
    compareCommits: () =>
      response(compareResponse({ status: "identical", total_commits: 0, commits: [] })),
    listPullRequests: async () => {
      calls.push("pulls");
      return response([mergedPull()]);
    },
    listIssues: async () => {
      calls.push("issues");
      return response([]);
    }
  });
  const result = await compareWith(api);
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.value.pullRequests, []);
  assert.deepEqual(result.value.issues, []);
  assert.deepEqual(result.value.contributors, []);
  assert.deepEqual(result.value.priorReleases, [
    {
      tag: "v1.0.0",
      url: "https://github.com/example/project/releases/tag/v1.0.0",
      title: "v1.0.0"
    }
  ]);
  assert.deepEqual(calls, []);
});

test("marks a retained pull request reverted when another retained pull request reverts it", async () => {
  const api = apiWith({
    listPullRequests: () =>
      response([
        mergedPull(),
        mergedPull({
          number: 7,
          html_url: "https://github.com/example/project/pull/7",
          title: 'Revert "Merged in-range change"',
          merge_commit_sha: RANGE_SHA_B,
          body: `Reverts ${repository.owner}/${repository.name}#1`
        })
      ])
  });
  const result = await compareWith(api);
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  const reverted = result.value.pullRequests.find(
    (pr) => pr.sourceIdentity === "pull/1"
  );
  const reverter = result.value.pullRequests.find(
    (pr) => pr.sourceIdentity === "pull/7"
  );
  assert.equal(reverted?.reverted, true);
  assert.equal(reverter?.reverted, false);
});

test("rejects comparison responses whose repository identity conflicts with scope", async () => {
  const api = apiWith({
    compareCommits: () =>
      response(
        compareResponse({ html_url: "https://github.com/other/project/compare/a...b" })
      )
  });
  const result = await compareWith(api);
  assert.deepEqual(result, {
    status: "failed",
    operationId: "compare-1",
    errorClass: "invalid-input"
  });
});

test("rejects comparison responses whose repository identity cannot be established", async () => {
  for (const html_url of [
    undefined,
    "not a url",
    "https://example.com/compare/a...b"
  ]) {
    const result = await compareWith(
      apiWith({
        compareCommits: () =>
          response(
            html_url === undefined
              ? { status: "ahead", total_commits: 1, commits: [{ sha: RANGE_SHA_A }] }
              : compareResponse({ html_url })
          )
      })
    );
    assert.deepEqual(result, {
      status: "failed",
      operationId: "compare-1",
      errorClass: "invalid-input"
    });
  }
});

test("rejects comparison responses that claim commits but carry none", async () => {
  const missing = await compareWith(
    apiWith({
      compareCommits: () => response({ status: "ahead", total_commits: 2 })
    })
  );
  assert.deepEqual(missing, {
    status: "failed",
    operationId: "compare-1",
    errorClass: "invalid-input"
  });

  const unparseable = await compareWith(
    apiWith({
      compareCommits: () =>
        response(compareResponse({ commits: [{ no_sha: true }, "junk"] }))
    })
  );
  assert.deepEqual(unparseable, {
    status: "failed",
    operationId: "compare-1",
    errorClass: "invalid-input"
  });
});

test("bounds pull request fan-out to maxPages", async () => {
  const calls: number[] = [];
  const api = apiWith({
    listPullRequests: async (params) => {
      calls.push(params.page);
      return response(Array.from({ length: 100 }, () => mergedPull()));
    }
  });
  const result = await compareWith(api, { repository, maxPages: 2 });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [1, 2]);
});

test("maps repository reads and rejects repositories outside scope", async () => {
  const reader = createGitHubReader(apiWith(), { repository });
  const repositoryResult = await reader.getRepository({
    operationId: "repo-1",
    repository
  });
  assert.equal(repositoryResult.status, "completed");
  if (repositoryResult.status === "completed") {
    assert.deepEqual(repositoryResult.value, {
      id: "42",
      owner: "example",
      name: "project",
      url: "https://github.com/example/project"
    });
  }
  assert.deepEqual(
    await reader.getRepository({
      operationId: "scope-1",
      repository: { owner: "other", name: "project" }
    }),
    { status: "refused", operationId: "scope-1", errorClass: "invalid-input" }
  );
});

test("maps conflict, authorization, rate-limit, and malformed responses to safe errors", async () => {
  const conflict = await compareWith(
    apiWith({ compareCommits: () => Promise.reject({ status: 409 }) })
  );
  assert.deepEqual(conflict, {
    status: "refused",
    operationId: "compare-1",
    errorClass: "conflict"
  });

  const validation = await compareWith(
    apiWith({ compareCommits: () => Promise.reject({ status: 422 }) })
  );
  assert.deepEqual(validation, {
    status: "refused",
    operationId: "compare-1",
    errorClass: "conflict"
  });

  const authorization = await compareWith(
    apiWith({
      compareCommits: () => Promise.reject({ status: 403, token: "not logged" })
    })
  );
  assert.deepEqual(authorization, {
    status: "refused",
    operationId: "compare-1",
    errorClass: "authorization"
  });

  const rateLimited = createGitHubReader(
    apiWith({
      getRepository: async () => Promise.reject({ response: { status: 429 } })
    }),
    { repository }
  );
  assert.deepEqual(
    await rateLimited.getRepository({ operationId: "rate-1", repository }),
    { status: "failed", operationId: "rate-1", errorClass: "rate-limit" }
  );

  const malformed = await compareWith(
    apiWith({ compareCommits: () => response("not a record") })
  );
  assert.deepEqual(malformed, {
    status: "failed",
    operationId: "compare-1",
    errorClass: "invalid-input"
  });
  assert.equal("token" in authorization, false);
});
