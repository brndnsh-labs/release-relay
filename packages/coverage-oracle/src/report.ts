import {
  type ConfidenceBand,
  confidenceBands,
  type Provider,
  providers
} from "./schema.js";

export const fileDispositions = ["scanned", "excluded"] as const;

export type FileDisposition = (typeof fileDispositions)[number];

export interface ReportFile {
  file: string;
  disposition: FileDisposition;
  reason?: string;
}

/**
 * The anchor-shaped v1 observation is retained only so the staged v1
 * comparator can continue to read historical reports. New reports are v2.
 */
export interface ReportObservationV1 {
  file: string;
  anchor: string;
  line: number;
  provider: Provider;
  identifier: string;
  evidenceKind: string;
  confidence: ConfidenceBand;
}

/** A source-free detector observation, preserved without oracle attribution. */
export interface ReportObservationV2 {
  file: string;
  lineStart: number;
  lineEnd: number;
  provider: Provider;
  identifier: string;
  evidenceKind: string;
  confidence: ConfidenceBand;
}

export interface ScanReportV1 {
  reportVersion: 1;
  manifestVersion: 1;
  releaseRelayRevision: string;
  breakscopeRevision: string;
  ruleset: string;
  files: ReportFile[];
  observations: ReportObservationV1[];
}

export interface ScanReportV2 {
  reportVersion: 2;
  manifestVersion: 1;
  releaseRelayRevision: string;
  breakscopeRevision: string;
  ruleset: string;
  files: ReportFile[];
  observations: ReportObservationV2[];
}

/** @deprecated Use ReportObservationV2 for newly normalized reports. */
export type ReportObservation = ReportObservationV1;
export type ScanReport = ScanReportV1 | ScanReportV2;

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
const OBSERVATION_V1_KEYS = [
  "file",
  "anchor",
  "line",
  "provider",
  "identifier",
  "evidenceKind",
  "confidence"
] as const;
const OBSERVATION_V2_KEYS = [
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

function validateFiles(input: Record<string, unknown>, errors: string[]): void {
  if (!Array.isArray(input.files)) {
    errors.push("report.files must be an array");
    return;
  }

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
      errors.push(`${where}.disposition must be one of ${fileDispositions.join(", ")}`);
    } else if (disposition === "excluded") {
      requireNonEmptyString(where, rawFile.reason, "reason", errors);
    } else if (rawFile.reason !== undefined) {
      errors.push(`${where}.reason must not be present for disposition scanned`);
    }
  }
}

function validateObservationCommon(
  where: string,
  observation: Record<string, unknown>,
  errors: string[]
): void {
  requireNonEmptyString(where, observation.file, "file", errors);

  if (
    typeof observation.provider !== "string" ||
    !providers.includes(observation.provider as Provider)
  ) {
    errors.push(`${where}.provider must be one of ${providers.join(", ")}`);
  }

  requireNonEmptyString(where, observation.identifier, "identifier", errors);
  requireNonEmptyString(where, observation.evidenceKind, "evidenceKind", errors);

  if (
    typeof observation.confidence !== "string" ||
    !confidenceBands.includes(observation.confidence as ConfidenceBand)
  ) {
    errors.push(`${where}.confidence must be one of ${confidenceBands.join(", ")}`);
  }
}

function validateObservations(
  input: Record<string, unknown>,
  version: 1 | 2,
  errors: string[]
): void {
  if (!Array.isArray(input.observations)) {
    errors.push("report.observations must be an array");
    return;
  }

  const seenKeys = new Set<string>();
  for (const [index, rawObservation] of input.observations.entries()) {
    const where = `report.observations[${index}]`;
    if (!isRecord(rawObservation)) {
      errors.push(`${where} must be an object`);
      continue;
    }

    if (version === 1) {
      rejectUnknownKeys(where, rawObservation, OBSERVATION_V1_KEYS, errors);
      const anchor = requireNonEmptyString(
        where,
        rawObservation.anchor,
        "anchor",
        errors
      );
      if (anchor !== undefined) checkAnchorHygiene(where, anchor, errors);
      if (
        typeof rawObservation.line !== "number" ||
        !Number.isInteger(rawObservation.line) ||
        rawObservation.line < 1
      ) {
        errors.push(`${where}.line must be a positive integer`);
      }
    } else {
      rejectUnknownKeys(where, rawObservation, OBSERVATION_V2_KEYS, errors);
      if (
        typeof rawObservation.lineStart !== "number" ||
        !Number.isInteger(rawObservation.lineStart) ||
        rawObservation.lineStart < 1
      ) {
        errors.push(`${where}.lineStart must be a positive integer`);
      }
      if (
        typeof rawObservation.lineEnd !== "number" ||
        !Number.isInteger(rawObservation.lineEnd) ||
        rawObservation.lineEnd < 1
      ) {
        errors.push(`${where}.lineEnd must be a positive integer`);
      }
      if (
        typeof rawObservation.lineStart === "number" &&
        typeof rawObservation.lineEnd === "number" &&
        rawObservation.lineStart > rawObservation.lineEnd
      ) {
        errors.push(`${where}.lineStart must be <= lineEnd`);
      }
    }

    validateObservationCommon(where, rawObservation, errors);

    if (
      typeof rawObservation.file === "string" &&
      typeof rawObservation.provider === "string" &&
      typeof rawObservation.identifier === "string"
    ) {
      const location =
        version === 1
          ? typeof rawObservation.anchor === "string"
            ? rawObservation.anchor
            : ""
          : typeof rawObservation.lineStart === "number" &&
              typeof rawObservation.lineEnd === "number"
            ? `${rawObservation.lineStart}-${rawObservation.lineEnd}`
            : "";
      const key = [
        rawObservation.file,
        location,
        rawObservation.provider,
        rawObservation.identifier
      ].join("\u0000");
      if (seenKeys.has(key)) {
        errors.push(
          `${where} duplicates the observation for ${rawObservation.provider} ${rawObservation.identifier} at ${rawObservation.file}${version === 1 ? ` anchor ${location}` : `:${location}`}`
        );
      }
      seenKeys.add(key);
    }
  }
}

export function validateReport(input: unknown): ReportValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["report must be an object"] };
  }

  const errors: string[] = [];
  rejectUnknownKeys("report", input, REPORT_KEYS, errors);

  const version = input.reportVersion;
  if (version !== 1 && version !== 2) {
    errors.push("report.reportVersion must be the integer 1 or 2");
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
  validateFiles(input, errors);
  if (version === 1 || version === 2) validateObservations(input, version, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (version === 1) {
    const report: ScanReportV1 = {
      reportVersion: 1,
      manifestVersion: 1,
      releaseRelayRevision: input.releaseRelayRevision as string,
      breakscopeRevision: input.breakscopeRevision as string,
      ruleset: input.ruleset as string,
      files: input.files as ScanReportV1["files"],
      observations: input.observations as ScanReportV1["observations"]
    };
    return { ok: true, report };
  }
  const report: ScanReportV2 = {
    reportVersion: 2,
    manifestVersion: 1,
    releaseRelayRevision: input.releaseRelayRevision as string,
    breakscopeRevision: input.breakscopeRevision as string,
    ruleset: input.ruleset as string,
    files: input.files as ScanReportV2["files"],
    observations: input.observations as ScanReportV2["observations"]
  };
  return { ok: true, report };
}
