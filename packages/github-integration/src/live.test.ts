import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubReader, type GitHubApi } from "./live.js";
import type { RepositoryRef } from "@release-relay/core";

const repository: RepositoryRef = { owner: "example", name: "project" };

function response(data: unknown) {
  return Promise.resolve({ data });
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
    compareCommits: () => response({ status: "ahead" }),
    listPullRequests: () =>
      response([
        {
          number: 1,
          html_url: "https://github.com/example/project/pull/1",
          title: "Merged change",
          merged_at: "2026-08-18T00:00:00Z"
        },
        {
          number: 2,
          html_url: "https://github.com/example/project/pull/2",
          title: "Open change"
        }
      ]),
    listIssues: () =>
      response([
        {
          number: 3,
          html_url: "https://github.com/example/project/issues/3",
          title: "Closed issue",
          state: "closed"
        },
        {
          number: 4,
          html_url: "https://github.com/example/project/issues/4",
          title: "Missing optional state"
        },
        {
          number: 5,
          html_url: "https://github.com/example/project/pull/5",
          title: "Pull request returned by issue endpoint",
          pull_request: {}
        }
      ]),
    listContributors: () =>
      response([
        { login: "contributor", html_url: "https://github.com/contributor" },
        { html_url: "https://github.com/missing-login" }
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

test("maps the configured repository and bounds pagination", async () => {
  const calls: Array<{ page: number; kind: string }> = [];
  const api = apiWith({
    listIssues: async (params) => {
      calls.push({ page: params.page, kind: "issues" });
      return response(
        params.page === 1 ? Array.from({ length: 100 }, () => ({ number: 1 })) : []
      );
    }
  });
  const reader = createGitHubReader(api, { repository, maxPages: 2 });
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

  const comparison = await reader.compare({
    operationId: "compare-1",
    repository,
    range: { base: "v1.0.0", head: "main" }
  });
  assert.equal(comparison.status, "completed");
  assert.deepEqual(calls, [
    { page: 1, kind: "issues" },
    { page: 2, kind: "issues" }
  ]);
  if (comparison.status === "completed") {
    assert.equal(comparison.value.pullRequests[0]?.merged, true);
    assert.equal(comparison.value.pullRequests[1]?.merged, false);
    assert.equal(comparison.value.issues.length, 0);
    assert.deepEqual(comparison.value.contributors, [
      { identity: "contributor", url: "https://github.com/contributor" }
    ]);
    assert.deepEqual(comparison.value.priorReleases, [
      {
        tag: "v1.0.0",
        url: "https://github.com/example/project/releases/tag/v1.0.0",
        title: "v1.0.0"
      }
    ]);
  }
});

test("maps partial optional fields without exposing malformed entries", async () => {
  const reader = createGitHubReader(apiWith(), { repository });
  const comparison = await reader.compare({
    operationId: "compare-optional",
    repository,
    range: { base: "v1.0.0", head: "main" }
  });
  assert.equal(comparison.status, "completed");
  if (comparison.status === "completed") {
    assert.deepEqual(comparison.value.issues, [
      {
        sourceIdentity: "issue/3",
        url: "https://github.com/example/project/issues/3",
        title: "Closed issue",
        closed: true,
        linkedPullRequestIdentities: []
      },
      {
        sourceIdentity: "issue/4",
        url: "https://github.com/example/project/issues/4",
        title: "Missing optional state",
        closed: false,
        linkedPullRequestIdentities: []
      }
    ]);
  }
});

test("rejects repositories outside the configured authenticated scope", async () => {
  let calls = 0;
  const reader = createGitHubReader(
    apiWith({
      getRepository: async () => {
        calls += 1;
        return response({});
      }
    }),
    { repository }
  );
  const result = await reader.getRepository({
    operationId: "scope-1",
    repository: { owner: "other", name: "project" }
  });
  assert.deepEqual(result, {
    status: "refused",
    operationId: "scope-1",
    errorClass: "invalid-input"
  });
  assert.equal(calls, 0);
});

test("maps authorization, rate-limit, and malformed responses to safe errors", async () => {
  const authorization = createGitHubReader(
    apiWith({
      getRepository: async () => Promise.reject({ status: 403, token: "not logged" })
    }),
    { repository }
  );
  assert.deepEqual(
    await authorization.getRepository({ operationId: "auth-1", repository }),
    { status: "refused", operationId: "auth-1", errorClass: "authorization" }
  );

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

  const malformed = createGitHubReader(
    apiWith({ getRepository: () => response({ id: 1 }) }),
    { repository }
  );
  const result = await malformed.getRepository({
    operationId: "malformed-1",
    repository
  });
  assert.deepEqual(result, {
    status: "failed",
    operationId: "malformed-1",
    errorClass: "invalid-input"
  });
  assert.equal("token" in result, false);
});
