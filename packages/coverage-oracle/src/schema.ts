export const providers = ["github", "openai", "anthropic", "stripe"] as const;

export type Provider = (typeof providers)[number];

export const outcomes = [
  "observation",
  "no-observation",
  "demoted",
  "excluded",
  "uncertain"
] as const;

export type Outcome = (typeof outcomes)[number];

export const confidenceBands = ["alertable", "supporting", "demoted", "none"] as const;

export type ConfidenceBand = (typeof confidenceBands)[number];

export interface OracleExpectation {
  outcome: Outcome;
  provider?: Provider;
  identifier?: string;
  evidenceKind?: string;
  confidence?: ConfidenceBand;
  reason?: string;
}

export interface OracleScenarioSource {
  file: string;
  anchor: string;
}

export interface OracleScenario {
  id: string;
  purpose: string;
  source: OracleScenarioSource;
  expectations: OracleExpectation[];
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface OracleManifest {
  version: 1;
  revision: string;
  scenarios: OracleScenario[];
}

export type ValidationResult =
  | { ok: true; manifest: OracleManifest }
  | { ok: false; errors: string[] };

const FULL_SHA = /^[0-9a-f]{40}$/;
const REVIEW_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const MANIFEST_KEYS = ["version", "revision", "scenarios"] as const;
const SCENARIO_KEYS = [
  "id",
  "purpose",
  "source",
  "expectations",
  "rationale",
  "reviewedBy",
  "reviewedAt"
] as const;
const SOURCE_KEYS = ["file", "anchor"] as const;
const EXPECTATION_KEYS = [
  "outcome",
  "provider",
  "identifier",
  "evidenceKind",
  "confidence",
  "reason"
] as const;

const OUTCOME_SHAPE: Record<
  Outcome,
  {
    required: readonly string[];
    forbidden: readonly string[];
    allowedConfidence: readonly ConfidenceBand[];
  }
> = {
  observation: {
    required: ["provider", "identifier", "evidenceKind", "confidence"],
    forbidden: ["reason"],
    allowedConfidence: ["alertable", "supporting"]
  },
  "no-observation": {
    required: ["provider", "identifier", "confidence"],
    forbidden: ["evidenceKind", "reason"],
    allowedConfidence: ["none"]
  },
  demoted: {
    required: ["provider", "identifier", "evidenceKind", "confidence"],
    forbidden: ["reason"],
    allowedConfidence: ["demoted"]
  },
  excluded: {
    required: ["confidence", "reason"],
    forbidden: ["provider", "identifier", "evidenceKind"],
    allowedConfidence: ["none"]
  },
  uncertain: {
    required: ["confidence"],
    forbidden: ["provider", "identifier", "evidenceKind", "reason"],
    allowedConfidence: ["none"]
  }
};

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

export function validateManifest(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  const errors: string[] = [];
  rejectUnknownKeys("manifest", input, MANIFEST_KEYS, errors);

  if (input.version !== 1) {
    errors.push("manifest.version must be the integer 1");
  }

  if (typeof input.revision !== "string" || !FULL_SHA.test(input.revision)) {
    errors.push("manifest.revision must be a full 40-character git commit SHA");
  }

  if (!Array.isArray(input.scenarios)) {
    return { ok: false, errors: [...errors, "manifest.scenarios must be an array"] };
  }
  if (input.scenarios.length === 0) {
    errors.push("manifest.scenarios must not be empty");
  }

  const seenIds = new Set<string>();
  const seenAnchors = new Set<string>();

  for (const [index, raw] of input.scenarios.entries()) {
    const where = `manifest.scenarios[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    rejectUnknownKeys(where, raw, SCENARIO_KEYS, errors);

    const id = requireNonEmptyString(where, raw.id, "id", errors);
    if (id !== undefined) {
      if (seenIds.has(id)) {
        errors.push(`${where}.id ${id} is duplicated across scenarios`);
      }
      seenIds.add(id);
    }
    requireNonEmptyString(where, raw.purpose, "purpose", errors);

    if (!isRecord(raw.source)) {
      errors.push(`${where}.source must be an object`);
    } else {
      const source = raw.source;
      const sourceWhere = `${where}.source`;
      rejectUnknownKeys(sourceWhere, source, SOURCE_KEYS, errors);
      requireNonEmptyString(sourceWhere, source.file, "file", errors);
      const anchor = requireNonEmptyString(
        sourceWhere,
        source.anchor,
        "anchor",
        errors
      );
      if (anchor !== undefined) {
        if (seenAnchors.has(anchor)) {
          errors.push(`${sourceWhere}.anchor ${anchor} is duplicated across scenarios`);
        }
        seenAnchors.add(anchor);
        for (const provider of providers) {
          if (anchor.toLowerCase().includes(provider)) {
            errors.push(
              `${sourceWhere}.anchor must not contain the provider name ${provider}`
            );
          }
        }
        if (anchor.includes("http://") || anchor.includes("https://")) {
          errors.push(`${sourceWhere}.anchor must not contain an endpoint URL`);
        }
      }
    }

    if (!Array.isArray(raw.expectations) || raw.expectations.length === 0) {
      errors.push(`${where}.expectations must be a non-empty array`);
    } else {
      for (const [expectationIndex, rawExpectation] of raw.expectations.entries()) {
        const expectationWhere = `${where}.expectations[${expectationIndex}]`;
        if (!isRecord(rawExpectation)) {
          errors.push(`${expectationWhere} must be an object`);
          continue;
        }
        rejectUnknownKeys(expectationWhere, rawExpectation, EXPECTATION_KEYS, errors);

        const outcome = rawExpectation.outcome;
        if (
          typeof outcome !== "string" ||
          !(outcomes as readonly string[]).includes(outcome as string)
        ) {
          errors.push(
            `${expectationWhere}.outcome must be one of ${outcomes.join(", ")}`
          );
          continue;
        }
        const shape = OUTCOME_SHAPE[outcome as Outcome];

        if (rawExpectation.provider !== undefined) {
          if (
            typeof rawExpectation.provider !== "string" ||
            !(providers as readonly string[]).includes(
              rawExpectation.provider as string
            )
          ) {
            errors.push(
              `${expectationWhere}.provider must be one of ${providers.join(", ")}`
            );
          }
        }

        for (const key of shape.required) {
          const value = rawExpectation[key];
          if (typeof value !== "string" || value.trim() === "") {
            errors.push(
              `${expectationWhere}.${key} is required for outcome ${outcome}`
            );
          }
        }
        for (const key of shape.forbidden) {
          if (rawExpectation[key] !== undefined) {
            errors.push(
              `${expectationWhere}.${key} must not be present for outcome ${outcome}`
            );
          }
        }
        if (rawExpectation.confidence !== undefined) {
          if (
            typeof rawExpectation.confidence !== "string" ||
            !(confidenceBands as readonly string[]).includes(
              rawExpectation.confidence as string
            )
          ) {
            errors.push(
              `${expectationWhere}.confidence must be one of ${confidenceBands.join(", ")}`
            );
          } else if (
            !(shape.allowedConfidence as readonly string[]).includes(
              rawExpectation.confidence as string
            )
          ) {
            errors.push(
              `${expectationWhere}.confidence ${String(rawExpectation.confidence)} is incompatible with outcome ${outcome}`
            );
          }
        }
      }
    }

    requireNonEmptyString(where, raw.rationale, "rationale", errors);
    requireNonEmptyString(where, raw.reviewedBy, "reviewedBy", errors);
    if (typeof raw.reviewedAt !== "string" || !REVIEW_DATE.test(raw.reviewedAt)) {
      errors.push(`${where}.reviewedAt must be a YYYY-MM-DD date`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const manifest: OracleManifest = {
    version: 1,
    revision: input.revision as string,
    scenarios: input.scenarios as OracleScenario[]
  };
  return { ok: true, manifest };
}
