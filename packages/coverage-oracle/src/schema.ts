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
  /** manifestVersion 2 only: stable identity, required on observation/demoted. */
  id?: string;
  /**
   * manifestVersion 2 only: provider-neutral anchor inside the relevant syntax
   * range, required on observation/demoted.
   */
  locationAnchor?: OracleScenarioSource;
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
  version: 1 | 2;
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
  "reason",
  "id",
  "locationAnchor"
] as const;

/** Outcomes that pin a specific call site and therefore need id + locationAnchor in v2. */
const LOCATED_OUTCOMES: readonly Outcome[] = ["observation", "demoted"];

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

  let validatedRevision: string | undefined;
  const validatedScenarios: OracleScenario[] = [];

  if (input.version !== 1 && input.version !== 2) {
    errors.push("manifest.version must be the integer 1 or 2");
  }
  const manifestVersion: 1 | 2 = input.version === 2 ? 2 : 1;

  if (typeof input.revision !== "string" || !FULL_SHA.test(input.revision)) {
    errors.push("manifest.revision must be a full 40-character git commit SHA");
  } else {
    validatedRevision = input.revision;
  }

  if (!Array.isArray(input.scenarios)) {
    return { ok: false, errors: [...errors, "manifest.scenarios must be an array"] };
  }
  if (input.scenarios.length === 0) {
    errors.push("manifest.scenarios must not be empty");
  }

  const seenIds = new Set<string>();
  const seenAnchors = new Set<string>();
  const seenExpectationIds = new Set<string>();
  const seenAnchorLocations = new Set<string>();

  for (const [index, raw] of input.scenarios.entries()) {
    const where = `manifest.scenarios[${index}]`;
    const scenarioErrorsBefore = errors.length;
    if (!isRecord(raw)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    rejectUnknownKeys(where, raw, SCENARIO_KEYS, errors);

    let validatedId: string | undefined;
    let validatedPurpose: string | undefined;
    let validatedSource: OracleScenarioSource | undefined;
    let validatedExpectations: OracleExpectation[] = [];
    let validatedRationale: string | undefined;
    let validatedReviewedBy: string | undefined;
    let validatedReviewedAt: string | undefined;

    const id = requireNonEmptyString(where, raw.id, "id", errors);
    if (id !== undefined) {
      if (seenIds.has(id)) {
        errors.push(`${where}.id ${id} is duplicated across scenarios`);
      }
      seenIds.add(id);
      validatedId = id;
    }
    const purpose = requireNonEmptyString(where, raw.purpose, "purpose", errors);
    if (purpose !== undefined) validatedPurpose = purpose;

    let sourceFile: string | undefined;
    let sourceAnchor: string | undefined;
    if (!isRecord(raw.source)) {
      errors.push(`${where}.source must be an object`);
    } else {
      const source = raw.source;
      const sourceWhere = `${where}.source`;
      rejectUnknownKeys(sourceWhere, source, SOURCE_KEYS, errors);
      const file = requireNonEmptyString(sourceWhere, source.file, "file", errors);
      if (file !== undefined) sourceFile = file;
      const anchor = requireNonEmptyString(
        sourceWhere,
        source.anchor,
        "anchor",
        errors
      );
      if (anchor !== undefined) {
        sourceAnchor = anchor;
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
      if (sourceFile !== undefined && sourceAnchor !== undefined) {
        validatedSource = { file: sourceFile, anchor: sourceAnchor };
        seenAnchorLocations.add(`${sourceFile}\u0000${sourceAnchor}`);
      }
    }

    if (!Array.isArray(raw.expectations) || raw.expectations.length === 0) {
      errors.push(`${where}.expectations must be a non-empty array`);
    } else {
      const expectationsForScenario: OracleExpectation[] = [];
      for (const [expectationIndex, rawExpectation] of raw.expectations.entries()) {
        const expectationWhere = `${where}.expectations[${expectationIndex}]`;
        const expErrorsBefore = errors.length;
        if (!isRecord(rawExpectation)) {
          errors.push(`${expectationWhere} must be an object`);
          continue;
        }
        rejectUnknownKeys(expectationWhere, rawExpectation, EXPECTATION_KEYS, errors);

        const outcome = rawExpectation.outcome;
        let validatedOutcome: Outcome | undefined;
        if (
          typeof outcome !== "string" ||
          !(outcomes as readonly string[]).includes(outcome as string)
        ) {
          errors.push(
            `${expectationWhere}.outcome must be one of ${outcomes.join(", ")}`
          );
          continue;
        } else {
          validatedOutcome = outcome as Outcome;
        }
        const shape = OUTCOME_SHAPE[validatedOutcome];

        let validatedProvider: Provider | undefined;
        let validatedIdentifier: string | undefined;
        let validatedEvidenceKind: string | undefined;
        let validatedConfidence: ConfidenceBand | undefined;
        let validatedReason: string | undefined;
        let validatedExpectationId: string | undefined;
        let validatedLocationAnchor: OracleScenarioSource | undefined;

        if (rawExpectation.id !== undefined) {
          const id = requireNonEmptyString(
            expectationWhere,
            rawExpectation.id,
            "id",
            errors
          );
          if (id !== undefined) {
            if (seenExpectationIds.has(id)) {
              errors.push(
                `${expectationWhere}.id ${id} is duplicated across expectations`
              );
            } else {
              seenExpectationIds.add(id);
            }
            validatedExpectationId = id;
          }
        }
        if (rawExpectation.locationAnchor !== undefined) {
          if (!isRecord(rawExpectation.locationAnchor)) {
            errors.push(`${expectationWhere}.locationAnchor must be an object`);
          } else {
            const anchorWhere = `${expectationWhere}.locationAnchor`;
            rejectUnknownKeys(
              anchorWhere,
              rawExpectation.locationAnchor,
              SOURCE_KEYS,
              errors
            );
            const anchorFile = requireNonEmptyString(
              anchorWhere,
              rawExpectation.locationAnchor.file,
              "file",
              errors
            );
            const anchorValue = requireNonEmptyString(
              anchorWhere,
              rawExpectation.locationAnchor.anchor,
              "anchor",
              errors
            );
            if (anchorFile !== undefined && anchorValue !== undefined) {
              const locationKey = `${anchorFile}\u0000${anchorValue}`;
              if (seenAnchorLocations.has(locationKey)) {
                errors.push(
                  `${anchorWhere} ${anchorValue} is duplicated in ${anchorFile}; anchors must identify exactly one location`
                );
              } else {
                seenAnchorLocations.add(locationKey);
              }
              for (const provider of providers) {
                if (anchorValue.toLowerCase().includes(provider)) {
                  errors.push(
                    `${anchorWhere}.anchor must not contain the provider name ${provider}`
                  );
                }
              }
              if (anchorValue.includes("http://") || anchorValue.includes("https://")) {
                errors.push(`${anchorWhere}.anchor must not contain an endpoint URL`);
              }
              validatedLocationAnchor = { file: anchorFile, anchor: anchorValue };
            }
          }
        }

        if (manifestVersion === 1) {
          if (rawExpectation.id !== undefined) {
            errors.push(`${expectationWhere}.id is only allowed in manifest version 2`);
          }
          if (rawExpectation.locationAnchor !== undefined) {
            errors.push(
              `${expectationWhere}.locationAnchor is only allowed in manifest version 2`
            );
          }
        } else if (LOCATED_OUTCOMES.includes(validatedOutcome as Outcome)) {
          if (rawExpectation.id === undefined) {
            errors.push(
              `${expectationWhere}.id is required for outcome ${outcome} in manifest version 2`
            );
          }
          if (rawExpectation.locationAnchor === undefined) {
            errors.push(
              `${expectationWhere}.locationAnchor is required for outcome ${outcome} in manifest version 2`
            );
          }
        } else {
          if (rawExpectation.id !== undefined) {
            errors.push(
              `${expectationWhere}.id must not be present for outcome ${outcome}`
            );
          }
          if (rawExpectation.locationAnchor !== undefined) {
            errors.push(
              `${expectationWhere}.locationAnchor must not be present for outcome ${outcome}`
            );
          }
        }

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
          } else {
            validatedProvider = rawExpectation.provider as Provider;
          }
        }
        // Capture identifier/evidenceKind/reason/confidence if present and valid for potential construction
        if (
          typeof rawExpectation.identifier === "string" &&
          rawExpectation.identifier.trim() !== ""
        ) {
          validatedIdentifier = rawExpectation.identifier;
        }
        if (
          typeof rawExpectation.evidenceKind === "string" &&
          rawExpectation.evidenceKind.trim() !== ""
        ) {
          validatedEvidenceKind = rawExpectation.evidenceKind;
        }
        if (
          typeof rawExpectation.confidence === "string" &&
          (confidenceBands as readonly string[]).includes(
            rawExpectation.confidence as string
          )
        ) {
          // capture optimistically; forbidden/incompatible checks will still push errors and prevent push
          validatedConfidence = rawExpectation.confidence as ConfidenceBand;
        }
        if (
          typeof rawExpectation.reason === "string" &&
          rawExpectation.reason.trim() !== ""
        ) {
          validatedReason = rawExpectation.reason;
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

        if (errors.length !== expErrorsBefore) continue;
        // Build validated expectation from captured locals (or raw if capture missed but validation passed)
        const exp: OracleExpectation = { outcome: validatedOutcome };
        if (validatedProvider !== undefined) exp.provider = validatedProvider;
        if (validatedIdentifier !== undefined) exp.identifier = validatedIdentifier;
        else if (typeof rawExpectation.identifier === "string")
          exp.identifier = rawExpectation.identifier;
        if (validatedEvidenceKind !== undefined)
          exp.evidenceKind = validatedEvidenceKind;
        else if (typeof rawExpectation.evidenceKind === "string")
          exp.evidenceKind = rawExpectation.evidenceKind;
        if (validatedConfidence !== undefined) exp.confidence = validatedConfidence;
        else if (typeof rawExpectation.confidence === "string")
          exp.confidence = rawExpectation.confidence as ConfidenceBand;
        if (validatedReason !== undefined) exp.reason = validatedReason;
        else if (typeof rawExpectation.reason === "string")
          exp.reason = rawExpectation.reason;
        if (validatedExpectationId !== undefined) exp.id = validatedExpectationId;
        if (validatedLocationAnchor !== undefined)
          exp.locationAnchor = validatedLocationAnchor;
        expectationsForScenario.push(exp);
      }
      validatedExpectations = expectationsForScenario;
    }

    const rationale = requireNonEmptyString(where, raw.rationale, "rationale", errors);
    if (rationale !== undefined) validatedRationale = rationale;
    const reviewedBy = requireNonEmptyString(
      where,
      raw.reviewedBy,
      "reviewedBy",
      errors
    );
    if (reviewedBy !== undefined) validatedReviewedBy = reviewedBy;
    if (typeof raw.reviewedAt !== "string" || !REVIEW_DATE.test(raw.reviewedAt)) {
      errors.push(`${where}.reviewedAt must be a YYYY-MM-DD date`);
    } else {
      validatedReviewedAt = raw.reviewedAt;
    }

    if (errors.length === scenarioErrorsBefore) {
      // All fields for this scenario must be present to be valid; validation already ensured no errors
      if (
        validatedId !== undefined &&
        validatedPurpose !== undefined &&
        validatedSource !== undefined &&
        validatedRationale !== undefined &&
        validatedReviewedBy !== undefined &&
        validatedReviewedAt !== undefined
      ) {
        validatedScenarios.push({
          id: validatedId,
          purpose: validatedPurpose,
          source: validatedSource,
          expectations: validatedExpectations,
          rationale: validatedRationale,
          reviewedBy: validatedReviewedBy,
          reviewedAt: validatedReviewedAt
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const manifest: OracleManifest = {
    version: manifestVersion,
    revision: validatedRevision!,
    scenarios: validatedScenarios
  };
  return { ok: true, manifest };
}
