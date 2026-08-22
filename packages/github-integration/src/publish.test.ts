import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubPublisher,
  type GitHubWriteApi,
  type GitHubWriteScope
} from "./publish.js";
import { releasePreviewHash } from "@release-relay/core";
import type {
  OperationResult,
  PublishedRelease,
  RepositoryRef
} from "@release-relay/core";

const repository: RepositoryRef = { owner: "example", name: "project" };

interface ReleaseParams {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
}

class FakeWriteApi implements GitHubWriteApi {
  readonly calls: string[] = [];
  canPublish = true;
  repositoryOverrides: Record<string, unknown> | undefined;
  release: ReleaseParams | undefined;
  createCalls = 0;
  timeoutAfterWrite = false;
  malformedAfterWrite = false;
  createGate: Promise<void> | undefined;

  getRepository(): Promise<{ data: unknown }> {
    this.calls.push("auth");
    return Promise.resolve({
      data: {
        id: 42,
        full_name: "example/project",
        permissions: {
          admin: false,
          push: this.canPublish,
          maintain: false
        },
        ...this.repositoryOverrides
      }
    });
  }

  getReleaseByTag(): Promise<{ data: unknown }> {
    this.calls.push("release");
    if (this.release === undefined) return Promise.reject({ status: 404 });
    return Promise.resolve({ data: releaseResponse(this.release) });
  }

  createRelease(
    params: ReleaseParams & { owner: string; repo: string }
  ): Promise<{ data: unknown }> {
    return (async () => {
      this.calls.push("create");
      this.createCalls += 1;
      if (this.createGate !== undefined) await this.createGate;
      this.release = { ...params };
      if (this.timeoutAfterWrite) throw new Error("request timed out");
      if (this.malformedAfterWrite) return { data: { tag_name: params.tag_name } };
      return { data: releaseResponse(params) };
    })();
  }
}

function releaseResponse(params: ReleaseParams): Record<string, unknown> {
  return {
    ...params,
    tag_name: params.tag_name,
    html_url: `https://github.com/example/project/releases/tag/${params.tag_name}`
  };
}

function value<T>(result: OperationResult<T>): T {
  if (result.status !== "completed" && result.status !== "duplicate") {
    throw new Error(`expected a value, got ${result.status}`);
  }
  return result.value;
}

async function prepared(api: FakeWriteApi, now: { value: Date }) {
  const scope: GitHubWriteScope = {
    repository,
    now: () => new Date(now.value),
    createToken: () => "confirmation-token"
  };
  const publisher = createGitHubPublisher(api, scope);
  const authorization = value(
    await publisher.getAuthorization({ operationId: "authorization-1", repository })
  );
  const preview = publisher.previewRelease({
    operationId: "publish-1",
    workspaceId: "workspace-1",
    repository,
    authorizationRevision: authorization.revision,
    tag: "v1.2.3",
    title: "Release title",
    body: "Release body",
    draft: false,
    prerelease: true
  });
  const confirmation = value(
    publisher.confirmRelease({
      preview,
      authorizationRevision: authorization.revision
    })
  );
  return { publisher, preview, confirmation, authorization };
}

test("previews the exact release and rejects changed content", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  const { publisher, preview, confirmation } = await prepared(api, now);

  assert.deepEqual(
    {
      operationId: preview.operationId,
      repository: preview.repository,
      tag: preview.tag,
      title: preview.title,
      body: preview.body,
      draft: preview.draft,
      prerelease: preview.prerelease
    },
    {
      operationId: "publish-1",
      repository,
      tag: "v1.2.3",
      title: "Release title",
      body: "Release body",
      draft: false,
      prerelease: true
    }
  );

  const changed = await publisher.publishRelease({
    ...preview,
    title: "Changed after confirmation",
    confirmation
  });
  assert.deepEqual(changed, {
    status: "failed",
    operationId: "publish-1",
    errorClass: "invalid-input"
  });
  assert.equal(api.createCalls, 0);
});

test("does not accept a client-forged expiry hash", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  const { publisher, preview, authorization } = await prepared(api, now);
  const { previewHash: _previewHash, ...fields } = preview;
  const forgedFields = {
    ...fields,
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  const forged = {
    ...forgedFields,
    previewHash: releasePreviewHash(forgedFields)
  };
  assert.deepEqual(
    publisher.confirmRelease({
      preview: forged,
      authorizationRevision: authorization.revision
    }),
    {
      status: "failed",
      operationId: "publish-1",
      errorClass: "invalid-input"
    }
  );
});

test("expires confirmations and refuses changed authorization", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  const preparedPublication = await prepared(api, now);
  now.value = new Date(Date.parse(preparedPublication.preview.expiresAt) + 1);
  assert.deepEqual(
    await preparedPublication.publisher.publishRelease({
      ...preparedPublication.preview,
      confirmation: preparedPublication.confirmation
    }),
    {
      status: "failed",
      operationId: "publish-1",
      errorClass: "invalid-input"
    }
  );

  const current = { value: new Date("2026-08-18T23:00:00.000Z") };
  const revokedApi = new FakeWriteApi();
  const revoked = await prepared(revokedApi, current);
  revokedApi.canPublish = false;
  assert.deepEqual(
    await revoked.publisher.publishRelease({
      ...revoked.preview,
      confirmation: revoked.confirmation
    }),
    {
      status: "refused",
      operationId: "publish-1",
      errorClass: "authorization"
    }
  );
  assert.equal(revokedApi.createCalls, 0);
});

test("returns a known duplicate after expiry without requiring write access", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  const { publisher, preview, confirmation } = await prepared(api, now);
  const request = { ...preview, confirmation };
  assert.equal((await publisher.publishRelease(request)).status, "completed");
  now.value = new Date(Date.parse(preview.expiresAt) + 1);
  api.canPublish = false;
  assert.equal((await publisher.publishRelease(request)).status, "duplicate");
  assert.equal(api.createCalls, 1);
});

test("rechecks access immediately before creating and deduplicates retries", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  const { publisher, preview, confirmation } = await prepared(api, now);
  const request = { ...preview, confirmation };

  assert.deepEqual(await publisher.publishRelease(request), {
    status: "completed",
    operationId: "publish-1",
    value: {
      tag: "v1.2.3",
      url: "https://github.com/example/project/releases/tag/v1.2.3"
    }
  } satisfies OperationResult<PublishedRelease>);
  assert.deepEqual(await publisher.publishRelease(request), {
    status: "duplicate",
    operationId: "publish-1",
    value: {
      tag: "v1.2.3",
      url: "https://github.com/example/project/releases/tag/v1.2.3"
    }
  } satisfies OperationResult<PublishedRelease>);
  assert.equal(api.createCalls, 1);
  assert.deepEqual(api.calls, ["auth", "auth", "release", "auth", "create", "auth"]);
});

test("reconciles a timeout after GitHub created the release", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  api.timeoutAfterWrite = true;
  const { publisher, preview, confirmation } = await prepared(api, now);
  const request = { ...preview, confirmation };

  const first = await publisher.publishRelease(request);
  assert.equal(first.status, "completed");
  assert.equal(api.createCalls, 1);
  assert.equal((await publisher.publishRelease(request)).status, "duplicate");
  assert.equal(api.createCalls, 1);
});

test("reconciles malformed create responses after a write", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  api.malformedAfterWrite = true;
  const { publisher, preview, confirmation } = await prepared(api, now);
  const result = await publisher.publishRelease({ ...preview, confirmation });
  assert.equal(result.status, "completed");
  assert.equal(api.createCalls, 1);
});

test("coalesces concurrent retries for one operation", async () => {
  const now = { value: new Date("2026-08-18T23:00:00.000Z") };
  const api = new FakeWriteApi();
  let releaseCreate!: () => void;
  api.createGate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const { publisher, preview, confirmation } = await prepared(api, now);
  const request = { ...preview, confirmation };
  const first = publisher.publishRelease(request);
  const second = publisher.publishRelease(request);
  releaseCreate();
  const results = await Promise.all([first, second]);
  assert.equal(results[0]?.status, "completed");
  assert.equal(results[1]?.status, "completed");
  assert.equal(api.createCalls, 1);
});

test("does not expose provider failures or write outside the configured scope", async () => {
  const api = new FakeWriteApi();
  const publisher = createGitHubPublisher(api, { repository });
  assert.deepEqual(
    await publisher.getAuthorization({
      operationId: "scope-1",
      repository: { owner: "other", name: "project" }
    }),
    {
      status: "refused",
      operationId: "scope-1",
      errorClass: "invalid-input"
    }
  );
  assert.throws(() =>
    publisher.previewRelease({
      operationId: "scope-2",
      workspaceId: "workspace-1",
      repository: { owner: "other", name: "project" },
      authorizationRevision: "revision",
      tag: "v1.2.3",
      title: "Release",
      body: "Body"
    })
  );
  assert.equal(api.calls.length, 0);
});

test("maps revoked provider access to a safe refusal", async () => {
  const api = new FakeWriteApi();
  api.canPublish = false;
  const publisher = createGitHubPublisher(api, { repository });
  const authorization = await publisher.getAuthorization({
    operationId: "auth-1",
    repository
  });
  assert.equal(authorization.status, "completed");
  if (authorization.status === "completed") {
    assert.equal(authorization.value.canPublish, false);
  }
});

test("rejects authorization responses whose repository id is not a safe integer", async () => {
  const api = new FakeWriteApi();
  api.repositoryOverrides = { id: Number.MAX_SAFE_INTEGER + 1 };
  const publisher = createGitHubPublisher(api, { repository });
  assert.deepEqual(
    await publisher.getAuthorization({ operationId: "auth-1", repository }),
    {
      status: "failed",
      operationId: "auth-1",
      errorClass: "invalid-input"
    }
  );
});

test("treats repository scope case-insensitively for getAuthorization and previewRelease", async () => {
  const configured: RepositoryRef = { owner: "acme", name: "widget" };
  const api = new FakeWriteApi();
  const publisher = createGitHubPublisher(api, { repository: configured });

  const authorized = await publisher.getAuthorization({
    operationId: "case-1",
    repository: { owner: "AcMe", name: "WiDgEt" }
  });
  assert.equal(authorized.status, "completed");

  const preview = publisher.previewRelease({
    operationId: "case-2",
    workspaceId: "workspace-1",
    repository: { owner: "AcMe", name: "WiDgEt" },
    authorizationRevision: "revision",
    tag: "v1.2.3",
    title: "Release",
    body: "Body"
  });
  assert.equal(preview.repository.owner, "AcMe");
  assert.equal(preview.repository.name, "WiDgEt");

  assert.deepEqual(
    await publisher.getAuthorization({
      operationId: "case-3",
      repository: { owner: "other", name: "widget" }
    }),
    {
      status: "refused",
      operationId: "case-3",
      errorClass: "invalid-input"
    }
  );
  assert.deepEqual(
    await publisher.getAuthorization({
      operationId: "case-4",
      repository: { owner: "acme", name: "other" }
    }),
    {
      status: "refused",
      operationId: "case-4",
      errorClass: "invalid-input"
    }
  );
  assert.throws(() =>
    publisher.previewRelease({
      operationId: "case-5",
      workspaceId: "workspace-1",
      repository: { owner: "other", name: "widget" },
      authorizationRevision: "revision",
      tag: "v1.2.3",
      title: "Release",
      body: "Body"
    })
  );
});
