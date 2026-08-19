import type { AiProvider } from "./ports.js";
import type { CandidateItem } from "./workspace.js";

export const changeGroupKinds = [
  "added",
  "changed",
  "fixed",
  "deprecated",
  "removed",
  "security"
] as const;

export type ChangeGroupKind = (typeof changeGroupKinds)[number];

export const draftTimeSources = ["operation-clock", "provider-reported"] as const;

export type DraftTimeSource = (typeof draftTimeSources)[number];

export interface DraftChangeItem {
  summary: string;
  sourceIdentities: readonly string[];
}

export interface DraftChangeGroup {
  kind: ChangeGroupKind;
  heading: string;
  items: readonly DraftChangeItem[];
}

export interface DraftAcknowledgement {
  contributor: string;
  sourceIdentities: readonly string[];
}

export interface DraftBody {
  title: string;
  summary: string;
  changeGroups: readonly DraftChangeGroup[];
  acknowledgements: readonly DraftAcknowledgement[];
  supporterNote?: string;
}

export interface DraftProvenance {
  provider: AiProvider;
  model: string;
  configurationId: string;
  generatedAt: string;
  timeSource: DraftTimeSource;
}

export interface StructuredReleaseDraft {
  body: DraftBody;
  provenance: DraftProvenance;
}

export interface DraftFinding {
  code: string;
  sourceIdentity?: string;
}

export type DraftValidationOutcome =
  | { ok: true; draft: StructuredReleaseDraft }
  | { ok: false; reason: "invalid-structure"; findings: readonly DraftFinding[] }
  | { ok: false; reason: "unsupported-claims"; findings: readonly DraftFinding[] };

export type DraftGeneration =
  | { kind: "validated-draft"; draft: StructuredReleaseDraft }
  | { kind: "invalid-structure"; findings: readonly DraftFinding[] }
  | { kind: "unsupported-claims"; findings: readonly DraftFinding[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isNonEmptyString(entry))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) {
      return false;
    }
  }
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseProvenance(
  value: unknown,
  findings: DraftFinding[]
): DraftProvenance | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "provider",
      "model",
      "configurationId",
      "generatedAt",
      "timeSource"
    ])
  ) {
    findings.push({ code: "invalid-provenance" });
    return undefined;
  }
  if (value.provider !== "openai" && value.provider !== "anthropic") {
    findings.push({ code: "invalid-provider" });
    return undefined;
  }
  if (!isNonEmptyString(value.model) || !isNonEmptyString(value.configurationId)) {
    findings.push({ code: "invalid-model-identity" });
    return undefined;
  }
  if (
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    findings.push({ code: "invalid-generated-at" });
    return undefined;
  }
  if (
    value.timeSource !== "operation-clock" &&
    value.timeSource !== "provider-reported"
  ) {
    findings.push({ code: "invalid-time-source" });
    return undefined;
  }
  return {
    provider: value.provider,
    model: value.model,
    configurationId: value.configurationId,
    generatedAt: value.generatedAt,
    timeSource: value.timeSource
  };
}

function parseChangeItem(
  value: unknown,
  findings: DraftFinding[]
): DraftChangeItem | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["summary", "sourceIdentities"])) {
    findings.push({ code: "invalid-change-item" });
    return undefined;
  }
  if (!isNonEmptyString(value.summary)) {
    findings.push({ code: "empty-change-summary" });
    return undefined;
  }
  if (!isStringArray(value.sourceIdentities)) {
    findings.push({ code: "invalid-source-references" });
    return undefined;
  }
  return { summary: value.summary, sourceIdentities: [...value.sourceIdentities] };
}

function parseChangeGroup(
  value: unknown,
  findings: DraftFinding[]
): DraftChangeGroup | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "heading", "items"])) {
    findings.push({ code: "invalid-change-group" });
    return undefined;
  }
  if (!changeGroupKinds.includes(value.kind as ChangeGroupKind)) {
    findings.push({ code: "invalid-change-group-kind" });
    return undefined;
  }
  if (!isNonEmptyString(value.heading)) {
    findings.push({ code: "empty-change-heading" });
    return undefined;
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    findings.push({ code: "empty-change-group" });
    return undefined;
  }
  const items: DraftChangeItem[] = [];
  for (const item of value.items) {
    const parsed = parseChangeItem(item, findings);
    if (parsed === undefined) {
      return undefined;
    }
    items.push(parsed);
  }
  return { kind: value.kind as ChangeGroupKind, heading: value.heading, items };
}

function parseAcknowledgement(
  value: unknown,
  findings: DraftFinding[]
): DraftAcknowledgement | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["contributor", "sourceIdentities"])) {
    findings.push({ code: "invalid-acknowledgement" });
    return undefined;
  }
  if (!isNonEmptyString(value.contributor)) {
    findings.push({ code: "empty-acknowledgement" });
    return undefined;
  }
  if (!isStringArray(value.sourceIdentities)) {
    findings.push({ code: "invalid-source-references" });
    return undefined;
  }
  return {
    contributor: value.contributor,
    sourceIdentities: [...value.sourceIdentities]
  };
}

function parseBody(value: unknown, findings: DraftFinding[]): DraftBody | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["title", "summary", "changeGroups", "acknowledgements"],
      ["supporterNote"]
    )
  ) {
    findings.push({ code: "invalid-body" });
    return undefined;
  }
  if (!isNonEmptyString(value.title) || !isNonEmptyString(value.summary)) {
    findings.push({ code: "empty-content" });
    return undefined;
  }
  if (value.supporterNote !== undefined && !isNonEmptyString(value.supporterNote)) {
    findings.push({ code: "empty-supporter-note" });
    return undefined;
  }
  if (!Array.isArray(value.changeGroups)) {
    findings.push({ code: "invalid-change-groups" });
    return undefined;
  }
  if (!Array.isArray(value.acknowledgements)) {
    findings.push({ code: "invalid-acknowledgements" });
    return undefined;
  }
  const changeGroups: DraftChangeGroup[] = [];
  for (const group of value.changeGroups) {
    const parsed = parseChangeGroup(group, findings);
    if (parsed === undefined) {
      return undefined;
    }
    changeGroups.push(parsed);
  }
  const acknowledgements: DraftAcknowledgement[] = [];
  for (const acknowledgement of value.acknowledgements) {
    const parsed = parseAcknowledgement(acknowledgement, findings);
    if (parsed === undefined) {
      return undefined;
    }
    acknowledgements.push(parsed);
  }
  return {
    title: value.title,
    summary: value.summary,
    changeGroups,
    acknowledgements,
    ...(value.supporterNote === undefined ? {} : { supporterNote: value.supporterNote })
  };
}

export function validateReleaseDraft(
  candidates: readonly CandidateItem[],
  value: unknown
): DraftValidationOutcome {
  const findings: DraftFinding[] = [];
  if (!isRecord(value) || !hasExactKeys(value, ["body", "provenance"])) {
    return {
      ok: false,
      reason: "invalid-structure",
      findings: [{ code: "invalid-draft" }]
    };
  }
  const body = parseBody(value.body, findings);
  const provenance = parseProvenance(value.provenance, findings);
  if (body === undefined || provenance === undefined) {
    return { ok: false, reason: "invalid-structure", findings };
  }

  const supplied = new Set(candidates.map((candidate) => candidate.sourceIdentity));
  const claimFindings: DraftFinding[] = [];
  const cited = new Set<string>();
  for (const group of body.changeGroups) {
    for (const item of group.items) {
      for (const sourceIdentity of item.sourceIdentities) {
        if (!supplied.has(sourceIdentity)) {
          claimFindings.push({ code: "unknown-source", sourceIdentity });
        }
        if (cited.has(sourceIdentity)) {
          claimFindings.push({ code: "duplicate-citation", sourceIdentity });
        } else {
          cited.add(sourceIdentity);
        }
      }
    }
  }
  for (const acknowledgement of body.acknowledgements) {
    for (const sourceIdentity of acknowledgement.sourceIdentities) {
      if (!supplied.has(sourceIdentity)) {
        claimFindings.push({ code: "unknown-source", sourceIdentity });
      }
    }
  }
  if (claimFindings.length > 0) {
    return { ok: false, reason: "unsupported-claims", findings: claimFindings };
  }
  return { ok: true, draft: { body, provenance } };
}

export function citedDraftSourceIdentities(
  draft: StructuredReleaseDraft
): readonly string[] {
  const cited: string[] = [];
  const seen = new Set<string>();
  for (const group of draft.body.changeGroups) {
    for (const item of group.items) {
      for (const sourceIdentity of item.sourceIdentities) {
        if (!seen.has(sourceIdentity)) {
          seen.add(sourceIdentity);
          cited.push(sourceIdentity);
        }
      }
    }
  }
  for (const acknowledgement of draft.body.acknowledgements) {
    for (const sourceIdentity of acknowledgement.sourceIdentities) {
      if (!seen.has(sourceIdentity)) {
        seen.add(sourceIdentity);
        cited.push(sourceIdentity);
      }
    }
  }
  return cited;
}
