import {
  confidenceBands,
  providers,
  type ConfidenceBand,
  type Provider
} from "./schema.js";

export const snapshotVersion = 1 as const;

export const allowedRepositories = ["brndnsh-labs/release-relay"] as const;
export const allowedRepositoryIds = [1338698763] as const;
export const allowedRulesets = ["typescript-deterministic-v5"] as const;
export const allowedSnapshotStatus = ["completed"] as const;

export type SnapshotFileDisposition = "scanned" | "excluded";

export interface SnapshotFile {
  file: string;
  disposition: SnapshotFileDisposition;
  reason?: string;
}

export interface SnapshotObservation {
  file: string;
  lineStart: number;
  lineEnd: number;
  provider: Provider;
  identifier: string;
  evidenceKind: string;
  confidence: number;
}

export interface SnapshotScan {
  id: string;
  status: "completed";
  completedAt: string;
}

export interface BreakscopeSnapshot {
  snapshotVersion: 1;
  repository: string;
  repositoryId: number;
  releaseRelayRevision: string;
  breakscopeRevision: string;
  ruleset: string;
  scan: SnapshotScan;
  files: SnapshotFile[];
  observations: SnapshotObservation[];
}

export type SnapshotValidationResult =
  | { ok: true; snapshot: BreakscopeSnapshot }
  | { ok: false; errors: string[] };

const FULL_SHA = /^[0-9a-f]{40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const SNAPSHOT_KEYS = [
  "snapshotVersion",
  "repository",
  "repositoryId",
  "releaseRelayRevision",
  "breakscopeRevision",
  "ruleset",
  "scan",
  "files",
  "observations"
] as const;
const SCAN_KEYS = ["id", "status", "completedAt"] as const;
const FILE_KEYS = ["file", "disposition", "reason"] as const;
const OBS_KEYS = [
  "file",
  "lineStart",
  "lineEnd",
  "provider",
  "identifier",
  "evidenceKind",
  "confidence"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  where: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
  errors: string[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push(`${where} has unknown field ${key}`);
    }
  }
}

function requireNonEmptyString(
  where: string,
  value: unknown,
  key: string,
  errors: string[]
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${where}.${key} must be a non-empty string`);
    return undefined;
  }
  return value;
}

export function validateSnapshot(input: unknown): SnapshotValidationResult {
  if (!isRecord(input)) return { ok: false, errors: ["snapshot must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys("snapshot", input, SNAPSHOT_KEYS, errors);

  let validatedRepository: string | undefined;
  let validatedRepositoryId: number | undefined;
  let validatedReleaseRelayRevision: string | undefined;
  let validatedBreakscopeRevision: string | undefined;
  let validatedRuleset: string | undefined;
  let validatedScan: SnapshotScan | undefined;
  const validatedFiles: SnapshotFile[] = [];
  const validatedObservations: SnapshotObservation[] = [];

  if (input.snapshotVersion !== 1)
    errors.push("snapshot.snapshotVersion must be the integer 1");

  if (
    typeof input.repository !== "string" ||
    !(allowedRepositories as readonly string[]).includes(input.repository)
  ) {
    errors.push(`snapshot.repository must be one of ${allowedRepositories.join(", ")}`);
  } else {
    validatedRepository = input.repository;
  }
  if (
    typeof input.repositoryId !== "number" ||
    !(allowedRepositoryIds as readonly number[]).includes(input.repositoryId)
  ) {
    errors.push(
      `snapshot.repositoryId must be one of ${allowedRepositoryIds.join(", ")}`
    );
  } else {
    validatedRepositoryId = input.repositoryId;
  }
  if (
    typeof input.releaseRelayRevision !== "string" ||
    !FULL_SHA.test(input.releaseRelayRevision)
  ) {
    errors.push(
      "snapshot.releaseRelayRevision must be a full 40-character git commit SHA"
    );
  } else {
    validatedReleaseRelayRevision = input.releaseRelayRevision;
  }
  if (
    typeof input.breakscopeRevision !== "string" ||
    !FULL_SHA.test(input.breakscopeRevision)
  ) {
    errors.push(
      "snapshot.breakscopeRevision must be a full 40-character git commit SHA"
    );
  } else {
    validatedBreakscopeRevision = input.breakscopeRevision;
  }
  if (
    typeof input.ruleset !== "string" ||
    !(allowedRulesets as readonly string[]).includes(input.ruleset)
  ) {
    errors.push(`snapshot.ruleset must be one of ${allowedRulesets.join(", ")}`);
  } else {
    validatedRuleset = input.ruleset;
  }

  if (!isRecord(input.scan)) {
    errors.push("snapshot.scan must be an object");
  } else {
    const scan = input.scan;
    const scanErrorsBefore = errors.length;
    let scanId: string | undefined;
    let scanStatusValid = false;
    let scanCompletedAt: string | undefined;
    rejectUnknownKeys("snapshot.scan", scan, SCAN_KEYS, errors);
    const id = requireNonEmptyString("snapshot.scan", scan.id, "id", errors);
    if (id !== undefined) scanId = id;
    if (
      typeof scan.status !== "string" ||
      !(allowedSnapshotStatus as readonly string[]).includes(scan.status)
    ) {
      errors.push(
        `snapshot.scan.status must be one of ${allowedSnapshotStatus.join(", ")}`
      );
    } else {
      scanStatusValid = true;
    }
    if (typeof scan.completedAt !== "string" || !ISO_DATE.test(scan.completedAt)) {
      errors.push("snapshot.scan.completedAt must be an ISO-8601 UTC date");
    } else {
      scanCompletedAt = scan.completedAt;
    }
    if (
      errors.length === scanErrorsBefore &&
      scanId !== undefined &&
      scanStatusValid &&
      scanCompletedAt !== undefined
    ) {
      validatedScan = { id: scanId, status: "completed", completedAt: scanCompletedAt };
    }
  }

  if (!Array.isArray(input.files)) {
    errors.push("snapshot.files must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of input.files.entries()) {
      const where = `snapshot.files[${i}]`;
      const entryErrorsBefore = errors.length;
      if (!isRecord(raw)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      rejectUnknownKeys(where, raw, FILE_KEYS, errors);
      const file = requireNonEmptyString(where, raw.file, "file", errors);
      if (file !== undefined) {
        if (seen.has(file))
          errors.push(`${where}.file ${file} is duplicated in snapshot.files`);
        seen.add(file);
      }
      const disp = raw.disposition;
      let validatedDisposition: SnapshotFileDisposition | undefined;
      let validatedReason: string | undefined;
      if (typeof disp !== "string" || !["scanned", "excluded"].includes(disp)) {
        errors.push(`${where}.disposition must be one of scanned, excluded`);
      } else {
        validatedDisposition = disp === "excluded" ? "excluded" : "scanned";
        if (disp === "excluded") {
          const r = requireNonEmptyString(where, raw.reason, "reason", errors);
          if (r !== undefined) validatedReason = r;
        } else if (raw.reason !== undefined) {
          errors.push(`${where}.reason must not be present for disposition scanned`);
        }
      }
      if (
        errors.length === entryErrorsBefore &&
        file !== undefined &&
        validatedDisposition !== undefined
      ) {
        if (validatedDisposition === "excluded") {
          if (validatedReason !== undefined) {
            validatedFiles.push({
              file,
              disposition: validatedDisposition,
              reason: validatedReason
            });
          }
        } else {
          validatedFiles.push({ file, disposition: validatedDisposition });
        }
      }
    }
  }

  if (!Array.isArray(input.observations)) {
    errors.push("snapshot.observations must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of input.observations.entries()) {
      const where = `snapshot.observations[${i}]`;
      const entryErrorsBefore = errors.length;
      if (!isRecord(raw)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      rejectUnknownKeys(where, raw, OBS_KEYS, errors);
      const file = requireNonEmptyString(where, raw.file, "file", errors);
      let lineStartVal: number | undefined;
      if (
        typeof raw.lineStart !== "number" ||
        !Number.isInteger(raw.lineStart) ||
        raw.lineStart < 1
      ) {
        errors.push(`${where}.lineStart must be a positive integer`);
      } else {
        lineStartVal = raw.lineStart;
      }
      let lineEndVal: number | undefined;
      if (
        typeof raw.lineEnd !== "number" ||
        !Number.isInteger(raw.lineEnd) ||
        raw.lineEnd < 1
      ) {
        errors.push(`${where}.lineEnd must be a positive integer`);
      } else {
        lineEndVal = raw.lineEnd;
      }
      if (
        typeof raw.lineStart === "number" &&
        typeof raw.lineEnd === "number" &&
        raw.lineStart > raw.lineEnd
      ) {
        errors.push(`${where}.lineStart must be <= lineEnd`);
      }
      let providerVal: Provider | undefined;
      if (
        typeof raw.provider !== "string" ||
        !(providers as readonly string[]).includes(raw.provider as string)
      ) {
        errors.push(`${where}.provider must be one of ${providers.join(", ")}`);
      } else {
        providerVal = raw.provider as Provider;
      }
      const identifier = requireNonEmptyString(
        where,
        raw.identifier,
        "identifier",
        errors
      );
      const evidenceKind = requireNonEmptyString(
        where,
        raw.evidenceKind,
        "evidenceKind",
        errors
      );
      let confidenceVal: number | undefined;
      if (
        typeof raw.confidence !== "number" ||
        Number.isNaN(raw.confidence) ||
        raw.confidence < 0 ||
        raw.confidence > 1
      ) {
        errors.push(`${where}.confidence must be a number between 0 and 1`);
      } else {
        confidenceVal = raw.confidence;
      }
      // anchor hygiene for file? snapshot observations don't have anchor, but we check file anchor hygiene via snapshot? No.
      if (
        typeof raw.file === "string" &&
        typeof raw.provider === "string" &&
        typeof raw.identifier === "string" &&
        typeof raw.lineStart === "number"
      ) {
        const key = [
          raw.file,
          raw.provider,
          raw.identifier,
          String(raw.lineStart),
          String(raw.lineEnd)
        ].join("\u0000");
        if (seen.has(key))
          errors.push(
            `${where} duplicates observation for ${raw.provider} ${raw.identifier} at ${raw.file}:${raw.lineStart}-${raw.lineEnd}`
          );
        seen.add(key);
      }
      if (
        errors.length === entryErrorsBefore &&
        file !== undefined &&
        lineStartVal !== undefined &&
        lineEndVal !== undefined &&
        providerVal !== undefined &&
        identifier !== undefined &&
        evidenceKind !== undefined &&
        confidenceVal !== undefined
      ) {
        validatedObservations.push({
          file,
          lineStart: lineStartVal,
          lineEnd: lineEndVal,
          provider: providerVal,
          identifier,
          evidenceKind,
          confidence: confidenceVal
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const snapshot: BreakscopeSnapshot = {
    snapshotVersion: 1,
    repository: validatedRepository!,
    repositoryId: validatedRepositoryId!,
    releaseRelayRevision: validatedReleaseRelayRevision!,
    breakscopeRevision: validatedBreakscopeRevision!,
    ruleset: validatedRuleset!,
    scan: validatedScan!,
    files: validatedFiles,
    observations: validatedObservations
  };
  return { ok: true, snapshot };
}

export function mapConfidence(
  confidence: number,
  ruleset: string
): { ok: true; band: ConfidenceBand } | { ok: false; error: string } {
  if (ruleset === "typescript-deterministic-v5") {
    if (confidence >= 0.9) return { ok: true, band: "alertable" };
    if (confidence >= 0.5) return { ok: true, band: "supporting" };
    if (confidence > 0) return { ok: true, band: "demoted" };
    return { ok: true, band: "none" };
  }
  return { ok: false, error: `unknown ruleset ${ruleset} for confidence mapping` };
}
