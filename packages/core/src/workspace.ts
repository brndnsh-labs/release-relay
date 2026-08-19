import type { DraftBody, DraftTimeSource } from "./draft.js";
import type { AiProvider } from "./ports.js";

export const workspaceStates = [
  "collecting",
  "drafting",
  "review",
  "approved",
  "published"
] as const;

export type WorkspaceState = (typeof workspaceStates)[number];

export interface CandidateItem {
  sourceIdentity: string;
  sourceUrl: string;
  title: string;
  included: boolean;
  order: number;
  maintainerAnnotation?: string;
}

export type DraftRevision =
  | {
      id: string;
      origin: "human";
      parentRevisionId?: string;
      body: DraftBody;
    }
  | {
      id: string;
      origin: "generated";
      parentRevisionId?: string;
      provider: AiProvider;
      model: string;
      configurationId: string;
      generatedAt: string;
      timeSource: DraftTimeSource;
      body: DraftBody;
    };

export type PublishResult =
  | { status: "completed"; url: string }
  | { status: "attempted"; operationId: string };

export interface ReleaseWorkspace {
  id: string;
  state: WorkspaceState;
  candidates: readonly CandidateItem[];
  revisions: readonly DraftRevision[];
  publishedResult?: Extract<PublishResult, { status: "completed" }>;
}

export type WorkspaceError =
  | "transition-not-allowed"
  | "published-workspace-is-immutable"
  | "revision-not-allowed-in-state"
  | "revision-parent-unknown"
  | "revision-id-already-used"
  | "publish-requires-approved-workspace"
  | "publish-result-not-confirmed"
  | "publish-result-invalid";

export type WorkspaceResult =
  | { ok: true; workspace: ReleaseWorkspace }
  | { ok: false; error: WorkspaceError };

const allowedTransitions: Record<WorkspaceState, readonly WorkspaceState[]> = {
  collecting: ["drafting"],
  drafting: ["collecting", "review"],
  review: ["drafting", "approved"],
  approved: ["review"],
  published: []
};

export function createWorkspace(id: string): ReleaseWorkspace {
  return { id, state: "collecting", candidates: [], revisions: [] };
}

export function transition(
  workspace: ReleaseWorkspace,
  nextState: WorkspaceState
): WorkspaceResult {
  if (!allowedTransitions[workspace.state].includes(nextState)) {
    return { ok: false, error: "transition-not-allowed" };
  }
  return { ok: true, workspace: { ...workspace, state: nextState } };
}

export function updateCandidates(
  workspace: ReleaseWorkspace,
  candidates: readonly CandidateItem[]
): WorkspaceResult {
  if (workspace.state === "published") {
    return { ok: false, error: "published-workspace-is-immutable" };
  }
  return { ok: true, workspace: { ...workspace, candidates: [...candidates] } };
}

export function addRevision(
  workspace: ReleaseWorkspace,
  revision: DraftRevision
): WorkspaceResult {
  if (workspace.state === "published") {
    return { ok: false, error: "published-workspace-is-immutable" };
  }
  if (workspace.state !== "drafting" && workspace.state !== "review") {
    return { ok: false, error: "revision-not-allowed-in-state" };
  }
  if (workspace.revisions.some((existing) => existing.id === revision.id)) {
    return { ok: false, error: "revision-id-already-used" };
  }
  if (
    revision.parentRevisionId !== undefined &&
    !workspace.revisions.some((existing) => existing.id === revision.parentRevisionId)
  ) {
    return { ok: false, error: "revision-parent-unknown" };
  }
  return {
    ok: true,
    workspace: { ...workspace, revisions: [...workspace.revisions, revision] }
  };
}

export function publishWorkspace(
  workspace: ReleaseWorkspace,
  result: PublishResult
): WorkspaceResult {
  if (workspace.state !== "approved") {
    return { ok: false, error: "publish-requires-approved-workspace" };
  }
  if (result.status === "attempted") {
    return { ok: false, error: "publish-result-not-confirmed" };
  }
  if (result.url.trim() === "") {
    return { ok: false, error: "publish-result-invalid" };
  }
  return {
    ok: true,
    workspace: { ...workspace, state: "published", publishedResult: result }
  };
}
