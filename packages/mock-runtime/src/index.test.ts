import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import test, { mock } from "node:test";
import {
  addRevision,
  createWorkspace,
  publishWorkspace,
  transition,
  updateCandidates
} from "@release-relay/core";
import type {
  ComparisonRange,
  OperationResult,
  Provider,
  RepositoryRef,
  SponsorTier
} from "@release-relay/core";
import { createMockRuntime } from "./index.js";

const repository: RepositoryRef = { owner: "example", name: "project" };
const range: ComparisonRange = { base: "v0.1.0", head: "main" };
const tier: SponsorTier = {
  id: "supporter",
  name: "Supporter",
  description: "Thank you"
};

function value<T>(result: OperationResult<T>): T {
  if (result.status !== "completed" && result.status !== "duplicate") {
    throw new Error(`expected a value, got ${result.status}`);
  }
  return result.value;
}

function workspaceValue(result: ReturnType<typeof updateCandidates>) {
  if (!result.ok) {
    throw new Error(`expected a workspace, got ${result.error}`);
  }
  return result.workspace;
}

test("the runtime composes the offline release workflow", async () => {
  const runtime = createMockRuntime({
    seed: "workflow",
    startAt: "2026-02-03T04:05:06.000Z"
  });
  const candidates = value(
    await runtime.assembleCandidates({
      operationId: runtime.nextOperationId("comparison"),
      repository,
      range
    })
  );
  let workspace = createWorkspace("workspace-1");
  workspace = workspaceValue(updateCandidates(workspace, candidates));
  workspace = workspaceValue(transition(workspace, "drafting"));
  const draft = value(
    await runtime.drafter.draft({
      operationId: runtime.nextOperationId("draft"),
      candidates
    })
  );
  assert.equal(draft.kind, "validated-draft");
  if (draft.kind !== "validated-draft") {
    throw new Error("expected a validated draft");
  }
  assert.equal(draft.draft.provenance.timeSource, "operation-clock");
  assert.deepEqual(
    draft.draft.body.changeGroups.flatMap((group) =>
      group.items.map((item) => item.sourceIdentities)
    ),
    candidates
      .filter((candidate) => candidate.included)
      .map((candidate) => [candidate.sourceIdentity])
  );
  workspace = workspaceValue(
    addRevision(workspace, {
      id: "draft-1",
      origin: "generated",
      provider: draft.draft.provenance.provider,
      model: draft.draft.provenance.model,
      configurationId: draft.draft.provenance.configurationId,
      generatedAt: draft.draft.provenance.generatedAt,
      timeSource: draft.draft.provenance.timeSource,
      body: draft.draft.body
    })
  );
  workspace = workspaceValue(transition(workspace, "review"));
  const review = value(
    await runtime.reviewer.review({
      operationId: runtime.nextOperationId("review"),
      draft: draft.draft
    })
  );
  assert.equal(review.kind, "review");
  if (review.kind === "review") {
    assert.deepEqual(
      review.review.citedSourceIdentities,
      draft.draft.body.changeGroups.flatMap((group) =>
        group.items.flatMap((item) => item.sourceIdentities)
      )
    );
  }
  workspace = workspaceValue(transition(workspace, "approved"));
  const authorization = value(
    await runtime.publisher.getAuthorization({
      operationId: runtime.nextOperationId("authorization"),
      repository
    })
  );
  const preview = runtime.publisher.previewRelease({
    operationId: runtime.nextOperationId("publish"),
    workspaceId: workspace.id,
    repository,
    authorizationRevision: authorization.revision,
    tag: "v0.2.0",
    title: draft.draft.body.title,
    body: draft.draft.body.summary
  });
  const confirmation = value(
    runtime.publisher.confirmRelease({
      preview,
      authorizationRevision: authorization.revision
    })
  );
  const published = value(
    await runtime.publisher.publishRelease({ ...preview, confirmation })
  );
  workspace = workspaceValue(
    publishWorkspace(workspace, { status: "completed", url: published.url })
  );
  assert.equal(workspace.state, "published");

  assert.deepEqual(
    value(
      await runtime.billing.syncTier({
        operationId: runtime.nextOperationId("tier"),
        tier
      })
    ),
    tier
  );
  const checkout = value(
    await runtime.billing.createCheckout({
      operationId: runtime.nextOperationId("checkout"),
      tierId: tier.id
    })
  );
  assert.match(checkout.url, /^https:\/\/checkout\.example\.test\//);
  const portal = value(
    await runtime.billing.createPortal({
      operationId: runtime.nextOperationId("portal"),
      customerId: "customer-1"
    })
  );
  assert.match(portal.url, /^https:\/\/billing\.example\.test\//);
  const membership = value(
    await runtime.webhookProjector.project({
      eventId: runtime.nextOperationId("webhook"),
      customerId: "customer-1",
      membershipState: "active"
    })
  );
  assert.equal(membership.state, "active");
  assert.deepEqual(
    runtime.ledger.entries().map(({ provider, status }) => ({ provider, status })),
    [
      { provider: "github", status: "completed" },
      { provider: "openai", status: "completed" },
      { provider: "anthropic", status: "completed" },
      { provider: "github", status: "completed" },
      { provider: "github", status: "completed" },
      { provider: "stripe", status: "completed" },
      { provider: "stripe", status: "completed" },
      { provider: "stripe", status: "completed" },
      { provider: "stripe", status: "completed" }
    ]
  );
});

test("seeds and inputs produce identical values and ledger timestamps", async () => {
  async function run() {
    const runtime = createMockRuntime({
      seed: "same",
      startAt: "2026-01-01T00:00:00.000Z"
    });
    const operationId = runtime.nextOperationId("repository");
    const first = await runtime.reader.getRepository({ operationId, repository });
    const duplicate = await runtime.reader.getRepository({ operationId, repository });
    return { first, duplicate, entries: runtime.ledger.entries() };
  }

  assert.deepEqual(await run(), await run());
});

test("every provider boundary accepts scripted refusal and failure", async () => {
  const providers: readonly Provider[] = ["github", "openai", "anthropic", "stripe"];
  for (const outcome of ["refused", "failed"] as const) {
    for (const provider of providers) {
      const runtime = createMockRuntime({
        scriptedOutcomes: { [provider]: [outcome] }
      });
      let result: OperationResult<unknown>;
      if (provider === "github") {
        result = await runtime.reader.getRepository({
          operationId: "github-1",
          repository
        });
      } else if (provider === "openai" || provider === "anthropic") {
        result = await createDraft(runtime, provider);
      } else {
        result = await runtime.billing.createCheckout({
          operationId: "stripe-1",
          tierId: tier.id
        });
      }
      assert.equal(result.status, outcome, `${provider} ${outcome}`);
      assert.equal(runtime.ledger.entries()[0]?.status, outcome);
    }
  }
});

test("reusing a completed operation returns duplicate without a second effect", async () => {
  const runtime = createMockRuntime({ seed: "duplicates" });
  const input = { operationId: "checkout-1", tierId: tier.id };
  const first = await runtime.billing.createCheckout(input);
  const second = await runtime.billing.createCheckout(input);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "duplicate");
  assert.deepEqual(first.value, second.value);
  assert.deepEqual(
    runtime.ledger.entries().map(({ status, recordedAt }) => ({ status, recordedAt })),
    [
      { status: "completed", recordedAt: "2026-01-01T00:00:00.000Z" },
      { status: "duplicate", recordedAt: "2026-01-01T00:00:01.000Z" }
    ]
  );
});

test("mock mode does not touch fetch, DNS, or sockets", async () => {
  let fetchCalls = 0;
  let dnsCalls = 0;
  let socketCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    fetchCalls += 1;
    throw new Error("network disabled");
  });
  mock.method(dns, "lookup", () => {
    dnsCalls += 1;
    throw new Error("network disabled");
  });
  mock.method(net, "connect", () => {
    socketCalls += 1;
    throw new Error("network disabled");
  });

  const runtime = createMockRuntime();
  await runtime.reader.getRepository({ operationId: "repo-1", repository });
  await runtime.drafter.draft({ operationId: "draft-1", candidates: [] });
  await runtime.billing.createCheckout({ operationId: "checkout-1", tierId: tier.id });

  assert.equal(fetchCalls, 0);
  assert.equal(dnsCalls, 0);
  assert.equal(socketCalls, 0);
});

async function createDraft(
  runtime: ReturnType<typeof createMockRuntime>,
  provider: "openai" | "anthropic"
): Promise<OperationResult<unknown>> {
  if (provider === "openai") {
    return runtime.drafter.draft({ operationId: "openai-1", candidates: [] });
  }
  return runtime.reviewer.review({
    operationId: "anthropic-1",
    draft: {
      body: {
        title: "Draft",
        summary: "Summary",
        changeGroups: [],
        acknowledgements: []
      },
      provenance: {
        provider: "anthropic",
        model: "draft-model-1",
        configurationId: "config-1",
        generatedAt: "2026-02-03T04:05:06.000Z",
        timeSource: "operation-clock"
      }
    }
  });
}
