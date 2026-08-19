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

  if (input.snapshotVersion !== 1)
    errors.push("snapshot.snapshotVersion must be the integer 1");

  if (
    typeof input.repository !== "string" ||
    !allowedRepositories.includes(
      input.repository as (typeof allowedRepositories)[number]
    )
  ) {
    errors.push(`snapshot.repository must be one of ${allowedRepositories.join(", ")}`);
  }
  if (
    typeof input.repositoryId !== "number" ||
    !allowedRepositoryIds.includes(
      input.repositoryId as (typeof allowedRepositoryIds)[number]
    )
  ) {
    errors.push(
      `snapshot.repositoryId must be one of ${allowedRepositoryIds.join(", ")}`
    );
  }
  if (
    typeof input.releaseRelayRevision !== "string" ||
    !FULL_SHA.test(input.releaseRelayRevision)
  ) {
    errors.push(
      "snapshot.releaseRelayRevision must be a full 40-character git commit SHA"
    );
  }
  if (
    typeof input.breakscopeRevision !== "string" ||
    !FULL_SHA.test(input.breakscopeRevision)
  ) {
    errors.push(
      "snapshot.breakscopeRevision must be a full 40-character git commit SHA"
    );
  }
  if (
    typeof input.ruleset !== "string" ||
    !allowedRulesets.includes(input.ruleset as (typeof allowedRulesets)[number])
  ) {
    errors.push(`snapshot.ruleset must be one of ${allowedRulesets.join(", ")}`);
  }

  if (!isRecord(input.scan)) {
    errors.push("snapshot.scan must be an object");
  } else {
    const scan = input.scan;
    rejectUnknownKeys("snapshot.scan", scan, SCAN_KEYS, errors);
    requireNonEmptyString("snapshot.scan", scan.id, "id", errors);
    if (
      typeof scan.status !== "string" ||
      !allowedSnapshotStatus.includes(
        scan.status as (typeof allowedSnapshotStatus)[number]
      )
    ) {
      errors.push(
        `snapshot.scan.status must be one of ${allowedSnapshotStatus.join(", ")}`
      );
    }
    if (typeof scan.completedAt !== "string" || !ISO_DATE.test(scan.completedAt)) {
      errors.push("snapshot.scan.completedAt must be an ISO-8601 UTC date");
    }
  }

  if (!Array.isArray(input.files)) {
    errors.push("snapshot.files must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of input.files.entries()) {
      const where = `snapshot.files[${i}]`;
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
      if (typeof disp !== "string" || !["scanned", "excluded"].includes(disp)) {
        errors.push(`${where}.disposition must be one of scanned, excluded`);
      } else if (disp === "excluded") {
        requireNonEmptyString(where, raw.reason, "reason", errors);
      } else if (raw.reason !== undefined) {
        errors.push(`${where}.reason must not be present for disposition scanned`);
      }
    }
  }

  if (!Array.isArray(input.observations)) {
    errors.push("snapshot.observations must be an array");
  } else {
    const seen = new Set<string>();
    for (const [i, raw] of input.observations.entries()) {
      const where = `snapshot.observations[${i}]`;
      if (!isRecord(raw)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      rejectUnknownKeys(where, raw, OBS_KEYS, errors);
      requireNonEmptyString(where, raw.file, "file", errors);
      if (
        typeof raw.lineStart !== "number" ||
        !Number.isInteger(raw.lineStart) ||
        raw.lineStart < 1
      ) {
        errors.push(`${where}.lineStart must be a positive integer`);
      }
      if (
        typeof raw.lineEnd !== "number" ||
        !Number.isInteger(raw.lineEnd) ||
        raw.lineEnd < 1
      ) {
        errors.push(`${where}.lineEnd must be a positive integer`);
      }
      if (
        typeof raw.lineStart === "number" &&
        typeof raw.lineEnd === "number" &&
        raw.lineStart > raw.lineEnd
      ) {
        errors.push(`${where}.lineStart must be <= lineEnd`);
      }
      if (
        typeof raw.provider !== "string" ||
        !providers.includes(raw.provider as Provider)
      ) {
        errors.push(`${where}.provider must be one of ${providers.join(", ")}`);
      }
      requireNonEmptyString(where, raw.identifier, "identifier", errors);
      requireNonEmptyString(where, raw.evidenceKind, "evidenceKind", errors);
      if (
        typeof raw.confidence !== "number" ||
        Number.isNaN(raw.confidence) ||
        raw.confidence < 0 ||
        raw.confidence > 1
      ) {
        errors.push(`${where}.confidence must be a number between 0 and 1`);
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
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const snapshot: BreakscopeSnapshot = {
    snapshotVersion: 1,
    repository: input.repository as string,
    repositoryId: input.repositoryId as number,
    releaseRelayRevision: input.releaseRelayRevision as string,
    breakscopeRevision: input.breakscopeRevision as string,
    ruleset: input.ruleset as string,
    scan: input.scan as SnapshotScan,
    files: input.files as SnapshotFile[],
    observations: input.observations as SnapshotObservation[]
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
