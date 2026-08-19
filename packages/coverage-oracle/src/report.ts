import {
  confidenceBands,
  providers,
  type ConfidenceBand,
  type Provider
} from "./schema.js";

export const fileDispositions = ["scanned", "excluded"] as const;

export type FileDisposition = (typeof fileDispositions)[number];

export interface ReportFile {
  file: string;
  disposition: FileDisposition;
  reason?: string;
}

export interface ReportObservation {
  file: string;
  anchor: string;
  line: number;
  provider: Provider;
  identifier: string;
  evidenceKind: string;
  confidence: ConfidenceBand;
}

export interface ScanReport {
  reportVersion: 1;
  manifestVersion: 1;
  releaseRelayRevision: string;
  breakscopeRevision: string;
  ruleset: string;
  files: ReportFile[];
  observations: ReportObservation[];
}

export type ReportValidationResult =
  | { ok: true; report: ScanReport }
  | { ok: false; errors: string[] };

const FULL_SHA = /^[0-9a-f]{40}$/;

const REPORT_KEYS = [
  "reportVersion",
  "manifestVersion",
  "releaseRelayRevision",
  "breakscopeRevision",
  "ruleset",
  "files",
  "observations"
] as const;
const FILE_KEYS = ["file", "disposition", "reason"] as const;
const OBSERVATION_KEYS = [
  "file",
  "anchor",
  "line",
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

function checkAnchorHygiene(where: string, anchor: string, errors: string[]): void {
  for (const provider of providers) {
    if (anchor.toLowerCase().includes(provider)) {
      errors.push(`${where}.anchor must not contain the provider name ${provider}`);
    }
  }
  if (anchor.includes("http://") || anchor.includes("https://")) {
    errors.push(`${where}.anchor must not contain an endpoint URL`);
  }
}

export function validateReport(input: unknown): ReportValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["report must be an object"] };
  }

  const errors: string[] = [];
  rejectUnknownKeys("report", input, REPORT_KEYS, errors);

  if (input.reportVersion !== 1) {
    errors.push("report.reportVersion must be the integer 1");
  }
  if (input.manifestVersion !== 1) {
    errors.push("report.manifestVersion must be the integer 1");
  }

  if (
    typeof input.releaseRelayRevision !== "string" ||
    !FULL_SHA.test(input.releaseRelayRevision)
  ) {
    errors.push(
      "report.releaseRelayRevision must be a full 40-character git commit SHA"
    );
  }
  if (
    typeof input.breakscopeRevision !== "string" ||
    !FULL_SHA.test(input.breakscopeRevision)
  ) {
    errors.push("report.breakscopeRevision must be a full 40-character git commit SHA");
  }

  requireNonEmptyString("report", input.ruleset, "ruleset", errors);

  if (!Array.isArray(input.files)) {
    errors.push("report.files must be an array");
  } else {
    const seenFiles = new Set<string>();
    for (const [index, rawFile] of input.files.entries()) {
      const where = `report.files[${index}]`;
      if (!isRecord(rawFile)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      rejectUnknownKeys(where, rawFile, FILE_KEYS, errors);

      const file = requireNonEmptyString(where, rawFile.file, "file", errors);
      if (file !== undefined) {
        if (seenFiles.has(file)) {
          errors.push(`${where}.file ${file} is duplicated in report.files`);
        }
        seenFiles.add(file);
      }

      const disposition = rawFile.disposition;
      if (
        typeof disposition !== "string" ||
        !fileDispositions.includes(disposition as FileDisposition)
      ) {
        errors.push(
          `${where}.disposition must be one of ${fileDispositions.join(", ")}`
        );
      } else if (disposition === "excluded") {
        requireNonEmptyString(where, rawFile.reason, "reason", errors);
      } else if (rawFile.reason !== undefined) {
        errors.push(`${where}.reason must not be present for disposition scanned`);
      }
    }
  }

  if (!Array.isArray(input.observations)) {
    errors.push("report.observations must be an array");
  } else {
    const seenKeys = new Set<string>();
    for (const [index, rawObservation] of input.observations.entries()) {
      const where = `report.observations[${index}]`;
      if (!isRecord(rawObservation)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      rejectUnknownKeys(where, rawObservation, OBSERVATION_KEYS, errors);

      requireNonEmptyString(where, rawObservation.file, "file", errors);

      const anchor = requireNonEmptyString(
        where,
        rawObservation.anchor,
        "anchor",
        errors
      );
      if (anchor !== undefined) {
        checkAnchorHygiene(where, anchor, errors);
      }

      if (
        typeof rawObservation.line !== "number" ||
        !Number.isInteger(rawObservation.line) ||
        rawObservation.line < 1
      ) {
        errors.push(`${where}.line must be a positive integer`);
      }

      if (
        typeof rawObservation.provider !== "string" ||
        !providers.includes(rawObservation.provider as Provider)
      ) {
        errors.push(`${where}.provider must be one of ${providers.join(", ")}`);
      }

      requireNonEmptyString(where, rawObservation.identifier, "identifier", errors);
      requireNonEmptyString(where, rawObservation.evidenceKind, "evidenceKind", errors);

      if (
        typeof rawObservation.confidence !== "string" ||
        !confidenceBands.includes(rawObservation.confidence as ConfidenceBand)
      ) {
        errors.push(`${where}.confidence must be one of ${confidenceBands.join(", ")}`);
      }

      if (
        typeof rawObservation.file === "string" &&
        typeof rawObservation.anchor === "string" &&
        typeof rawObservation.provider === "string" &&
        typeof rawObservation.identifier === "string"
      ) {
        const key = [
          rawObservation.file,
          rawObservation.anchor,
          rawObservation.provider,
          rawObservation.identifier
        ].join("\u0000");
        if (seenKeys.has(key)) {
          errors.push(
            `${where} duplicates the observation for ${rawObservation.provider} ${rawObservation.identifier} at ${rawObservation.file} anchor ${rawObservation.anchor}`
          );
        }
        seenKeys.add(key);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, report: input as unknown as ScanReport };
}
