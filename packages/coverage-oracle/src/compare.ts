import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ConfidenceBand,
  OracleExpectation,
  OracleManifest,
  OracleScenario,
  Outcome,
  Provider
} from "./schema.js";
import type { ReportFile, ReportObservation, ScanReport } from "./report.js";

export type ComparisonStatus =
  | "matched"
  | "missing"
  | "unexpected"
  | "mismatched"
  | "unresolved";

export type MismatchDimension =
  | "provider"
  | "identifier"
  | "evidence-kind"
  | "location"
  | "confidence"
  | "disposition";

export interface ExpectationComparison {
  outcome: Outcome;
  status: ComparisonStatus;
  dimensions: MismatchDimension[];
  provider?: Provider;
  identifier?: string;
  evidenceKind?: string;
  confidence?: ConfidenceBand;
  detail: string;
}

export interface ScenarioComparison {
  scenarioId: string;
  file: string;
  anchor: string;
  anchorLine: number;
  results: ExpectationComparison[];
}

export interface UnexpectedObservation {
  file: string;
  anchor: string;
  line: number;
  provider: Provider;
  identifier: string;
  evidenceKind: string;
  confidence: ConfidenceBand;
  scenarioId: string | null;
  detail: string;
}

export interface OutcomeTotals {
  matched: number;
  missing: number;
  unexpected: number;
  mismatched: number;
  unresolved: number;
}

export interface ComparisonTotals extends OutcomeTotals {
  scenarios: number;
  expectations: number;
  unexpectedObservations: number;
}

export interface ComparisonReport {
  ok: boolean;
  revisions: {
    releaseRelay: string;
    breakscope: string;
    ruleset: string;
    manifestVersion: number;
    reportVersion: number;
  };
  totals: ComparisonTotals;
  byOutcome: Record<Outcome, OutcomeTotals>;
  unexpectedObservations: UnexpectedObservation[];
  scenarios: ScenarioComparison[];
}

export type ComparisonResult =
  | { ok: false; errors: string[] }
  | { ok: true; report: ComparisonReport };

function scenarioKey(file: string, anchor: string): string {
  return `${file}\u0000${anchor}`;
}

export function findAnchorLine(
  content: string,
  anchor: string
): { line: number } | { error: string } {
  const occurrences = content.split(anchor).length - 1;
  if (occurrences === 0) {
    return { error: "was not found" };
  }
  if (occurrences > 1) {
    return { error: `appears ${occurrences} times; expected exactly one` };
  }
  const index = content.indexOf(anchor);
  return { line: content.slice(0, index).split("\n").length };
}

function emptyTotals(): OutcomeTotals {
  return { matched: 0, missing: 0, unexpected: 0, mismatched: 0, unresolved: 0 };
}

function describeDisposition(file: ReportFile | undefined): string {
  if (file === undefined) {
    return "the file is not declared in report.files";
  }
  if (file.disposition === "excluded") {
    return `the file is declared excluded (${file.reason ?? "no reason given"})`;
  }
  return "the file is declared scanned";
}

function baseResult(expectation: OracleExpectation): ExpectationComparison {
  const result: ExpectationComparison = {
    outcome: expectation.outcome,
    status: "matched",
    dimensions: [],
    detail: ""
  };
  if (expectation.provider !== undefined) {
    result.provider = expectation.provider;
  }
  if (expectation.identifier !== undefined) {
    result.identifier = expectation.identifier;
  }
  if (expectation.evidenceKind !== undefined) {
    result.evidenceKind = expectation.evidenceKind;
  }
  if (expectation.confidence !== undefined) {
    result.confidence = expectation.confidence;
  }
  return result;
}

interface ScenarioContext {
  scenario: OracleScenario;
  anchorLine: number;
  fileEntry: ReportFile | undefined;
  observations: ReportObservation[];
  consumed: Set<ReportObservation>;
}

function availableObservations(context: ScenarioContext): ReportObservation[] {
  return context.observations.filter(
    (observation) => !context.consumed.has(observation)
  );
}

function compareEvidenceExpectation(
  expectation: OracleExpectation,
  context: ScenarioContext
): ExpectationComparison {
  const result = baseResult(expectation);
  const { scenario } = context;
  const exact = availableObservations(context).filter(
    (observation) =>
      observation.provider === expectation.provider &&
      observation.identifier === expectation.identifier
  );
  const scannedOk =
    context.fileEntry !== undefined && context.fileEntry.disposition === "scanned";

  const observation = exact[0];
  if (observation === undefined) {
    const sameIdentifier = availableObservations(context).filter(
      (candidate) => candidate.identifier === expectation.identifier
    );
    const sameProvider = availableObservations(context).filter(
      (candidate) => candidate.provider === expectation.provider
    );
    if (sameIdentifier[0] !== undefined) {
      const stray = sameIdentifier[0];
      context.consumed.add(stray);
      result.status = "mismatched";
      result.dimensions = ["provider"];
      result.detail = `expected provider ${expectation.provider}, but the report attributes ${expectation.identifier} to ${stray.provider} at ${scenario.source.file}:${stray.line}`;
      return result;
    }
    if (sameProvider[0] !== undefined) {
      const stray = sameProvider[0];
      context.consumed.add(stray);
      result.status = "mismatched";
      result.dimensions = ["identifier"];
      result.detail = `expected identifier ${expectation.identifier}, but the report reports ${stray.identifier} at ${scenario.source.file}:${stray.line}`;
      return result;
    }
    if (!scannedOk) {
      result.status = "mismatched";
      result.dimensions = ["disposition"];
      result.detail = `expected ${expectation.provider} ${expectation.identifier} evidence and it was not reported; ${describeDisposition(context.fileEntry)}`;
      return result;
    }
    result.status = "missing";
    result.detail = `expected ${expectation.provider} ${expectation.identifier} evidence at ${scenario.source.file}:${context.anchorLine} was not reported`;
    return result;
  }

  context.consumed.add(observation);
  const dimensions: MismatchDimension[] = [];
  const notes: string[] = [];
  if (observation.evidenceKind !== expectation.evidenceKind) {
    dimensions.push("evidence-kind");
    notes.push(
      `expected evidence kind ${expectation.evidenceKind}, found ${observation.evidenceKind}`
    );
  }
  if (observation.line !== context.anchorLine) {
    dimensions.push("location");
    notes.push(
      `expected location line ${context.anchorLine} (anchor resolution), found line ${observation.line}`
    );
  }
  if (observation.confidence !== expectation.confidence) {
    dimensions.push("confidence");
    notes.push(
      `expected confidence ${expectation.confidence}, found ${observation.confidence}`
    );
  }
  if (!scannedOk) {
    dimensions.push("disposition");
    notes.push(describeDisposition(context.fileEntry));
  }
  if (dimensions.length > 0) {
    result.status = "mismatched";
    result.dimensions = dimensions;
    result.detail = notes.join("; ");
  } else {
    result.detail = `matched at ${scenario.source.file}:${observation.line}`;
  }
  return result;
}

function compareNoObservationExpectation(
  expectation: OracleExpectation,
  context: ScenarioContext
): ExpectationComparison {
  const result = baseResult(expectation);
  const { scenario } = context;
  const exact = availableObservations(context).filter(
    (observation) =>
      observation.provider === expectation.provider &&
      observation.identifier === expectation.identifier
  );
  const scannedOk =
    context.fileEntry !== undefined && context.fileEntry.disposition === "scanned";

  if (exact[0] !== undefined) {
    const observation = exact[0];
    context.consumed.add(observation);
    result.status = "unexpected";
    result.detail = `expected no ${expectation.provider} ${expectation.identifier} observation, but the report contains one at ${scenario.source.file}:${observation.line}`;
    return result;
  }
  if (!scannedOk) {
    result.status = "mismatched";
    result.dimensions = ["disposition"];
    result.detail = `no-observation cannot be confirmed by absence alone: ${describeDisposition(context.fileEntry)}`;
    return result;
  }
  result.detail = "absent as expected";
  return result;
}

function compareExcludedExpectation(
  expectation: OracleExpectation,
  context: ScenarioContext
): ExpectationComparison {
  const result = baseResult(expectation);
  const { scenario, fileEntry } = context;
  const expectedReason = expectation.reason ?? "";
  if (
    fileEntry === undefined ||
    fileEntry.disposition !== "excluded" ||
    fileEntry.reason !== expectedReason
  ) {
    result.status = "mismatched";
    result.dimensions = ["disposition"];
    result.detail =
      fileEntry !== undefined && fileEntry.disposition === "excluded"
        ? `expected exclusion reason ${expectedReason}, found ${fileEntry.reason ?? "none"}`
        : `expected the file to be excluded (${expectedReason}), but ${describeDisposition(fileEntry)}`;
    return result;
  }
  const strays = availableObservations(context);
  if (strays.length > 0) {
    for (const stray of strays) {
      context.consumed.add(stray);
    }
    result.status = "unexpected";
    result.detail = `the file is excluded (${expectedReason}) but ${strays.length} observation(s) were reported at ${scenario.source.file}`;
    return result;
  }
  result.detail = `excluded as expected (${expectedReason})`;
  return result;
}

function compareUncertainExpectation(context: ScenarioContext): ExpectationComparison {
  const result: ExpectationComparison = {
    outcome: "uncertain",
    status: "unresolved",
    dimensions: [],
    detail: ""
  };
  const remaining = availableObservations(context);
  for (const observation of remaining) {
    context.consumed.add(observation);
  }
  const dispositionNote =
    context.fileEntry !== undefined && context.fileEntry.disposition === "scanned"
      ? ""
      : ` ${describeDisposition(context.fileEntry)}.`;
  if (remaining.length > 0) {
    result.detail = `uncertain expectation: ${remaining.length} observation(s) reported at this anchor require human review;${dispositionNote}`;
  } else {
    result.detail = `uncertain expectation: no observations reported; not converted into a confident negative;${dispositionNote}`;
  }
  return result;
}

export async function compareReports(
  manifest: OracleManifest,
  report: ScanReport,
  rootDir: string
): Promise<ComparisonResult> {
  const errors: string[] = [];

  if (report.releaseRelayRevision !== manifest.revision) {
    errors.push(
      `report.releaseRelayRevision ${report.releaseRelayRevision} does not match manifest.revision ${manifest.revision}: the oracle and the scan must pin the same Release Relay commit`
    );
  }
  if (report.manifestVersion !== manifest.version) {
    errors.push(
      `report.manifestVersion ${String(report.manifestVersion)} does not match manifest.version ${String(manifest.version)}`
    );
  }

  const anchorLines = new Map<string, number>();
  for (const scenario of manifest.scenarios) {
    let content: string;
    try {
      content = await readFile(resolve(rootDir, scenario.source.file), "utf8");
    } catch {
      errors.push(
        `${scenario.id}: source file ${scenario.source.file} could not be read`
      );
      continue;
    }
    const found = findAnchorLine(content, scenario.source.anchor);
    if ("error" in found) {
      errors.push(
        `${scenario.id}: anchor ${scenario.source.anchor} ${found.error} in ${scenario.source.file}`
      );
      continue;
    }
    anchorLines.set(scenario.id, found.line);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const contexts = new Map<string, ScenarioContext>();
  for (const scenario of manifest.scenarios) {
    contexts.set(scenarioKey(scenario.source.file, scenario.source.anchor), {
      scenario,
      anchorLine: anchorLines.get(scenario.id) ?? 0,
      fileEntry: report.files.find((file) => file.file === scenario.source.file),
      observations: [],
      consumed: new Set<ReportObservation>()
    });
  }
  const observationsWithoutScenario: ReportObservation[] = [];
  for (const observation of report.observations) {
    const context = contexts.get(scenarioKey(observation.file, observation.anchor));
    if (context === undefined) {
      observationsWithoutScenario.push(observation);
    } else {
      context.observations.push(observation);
    }
  }

  const byOutcome: Record<Outcome, OutcomeTotals> = {
    observation: emptyTotals(),
    "no-observation": emptyTotals(),
    demoted: emptyTotals(),
    excluded: emptyTotals(),
    uncertain: emptyTotals()
  };
  const totals: ComparisonTotals = {
    scenarios: manifest.scenarios.length,
    expectations: 0,
    matched: 0,
    missing: 0,
    unexpected: 0,
    mismatched: 0,
    unresolved: 0,
    unexpectedObservations: 0
  };

  const scenarioComparisons: ScenarioComparison[] = [];
  for (const [, context] of contexts) {
    const results: ExpectationComparison[] = [];
    for (const expectation of context.scenario.expectations) {
      if (expectation.outcome === "uncertain") {
        continue;
      }
      const result =
        expectation.outcome === "no-observation"
          ? compareNoObservationExpectation(expectation, context)
          : expectation.outcome === "excluded"
            ? compareExcludedExpectation(expectation, context)
            : compareEvidenceExpectation(expectation, context);
      results.push(result);
    }
    for (const expectation of context.scenario.expectations) {
      if (expectation.outcome !== "uncertain") {
        continue;
      }
      results.push(compareUncertainExpectation(context));
    }

    const comparison: ScenarioComparison = {
      scenarioId: context.scenario.id,
      file: context.scenario.source.file,
      anchor: context.scenario.source.anchor,
      anchorLine: context.anchorLine,
      results
    };
    scenarioComparisons.push(comparison);

    for (const result of results) {
      totals.expectations += 1;
      byOutcome[result.outcome][result.status] += 1;
      totals[result.status] += 1;
    }
  }

  const unexpectedObservations: UnexpectedObservation[] = [];
  const collectUnexpected = (
    observation: ReportObservation,
    scenarioId: string | null
  ): void => {
    const dispositionNote =
      report.files.find((file) => file.file === observation.file)?.disposition ===
      "excluded"
        ? "; the file is declared excluded in the report"
        : "";
    const detail =
      scenarioId === null
        ? `observation attributed to ${observation.file} anchor ${observation.anchor}, which matches no oracle scenario${dispositionNote}`
        : `no expectation in ${scenarioId} covers ${observation.provider} ${observation.identifier} at ${observation.file}:${observation.line}${dispositionNote}`;
    unexpectedObservations.push({
      file: observation.file,
      anchor: observation.anchor,
      line: observation.line,
      provider: observation.provider,
      identifier: observation.identifier,
      evidenceKind: observation.evidenceKind,
      confidence: observation.confidence,
      scenarioId,
      detail
    });
  };

  for (const observation of observationsWithoutScenario) {
    collectUnexpected(observation, null);
  }
  for (const [, context] of contexts) {
    for (const observation of context.observations) {
      if (!context.consumed.has(observation)) {
        collectUnexpected(observation, context.scenario.id);
      }
    }
  }
  totals.unexpectedObservations = unexpectedObservations.length;

  const comparisonReport: ComparisonReport = {
    ok:
      totals.missing === 0 &&
      totals.mismatched === 0 &&
      totals.unexpected === 0 &&
      totals.unexpectedObservations === 0,
    revisions: {
      releaseRelay: report.releaseRelayRevision,
      breakscope: report.breakscopeRevision,
      ruleset: report.ruleset,
      manifestVersion: manifest.version,
      reportVersion: report.reportVersion
    },
    totals,
    byOutcome,
    unexpectedObservations,
    scenarios: scenarioComparisons
  };
  return { ok: true, report: comparisonReport };
}

export function formatComparison(report: ComparisonReport): string {
  const lines: string[] = [];
  const { totals } = report;
  lines.push(
    `release-relay ${report.revisions.releaseRelay} breakscope ${report.revisions.breakscope} ruleset ${report.revisions.ruleset}`
  );
  lines.push(
    `scenarios=${totals.scenarios} expectations=${totals.expectations} matched=${totals.matched} missing=${totals.missing} mismatched=${totals.mismatched} unexpected=${totals.unexpected} unresolved=${totals.unresolved} unexpectedObservations=${totals.unexpectedObservations}`
  );
  for (const scenario of report.scenarios) {
    const flagged = scenario.results.filter((result) => result.status !== "matched");
    if (flagged.length === 0) {
      continue;
    }
    lines.push("");
    lines.push(`${scenario.scenarioId} (${scenario.file}:${scenario.anchorLine})`);
    for (const result of flagged) {
      const key = [result.provider, result.identifier]
        .filter((part) => part !== undefined)
        .join(" ");
      const dimensions =
        result.dimensions.length > 0 ? ` [${result.dimensions.join(", ")}]` : "";
      lines.push(
        `  ${result.status} ${result.outcome}${key === "" ? "" : ` ${key}`}${dimensions}: ${result.detail}`
      );
    }
  }
  if (report.unexpectedObservations.length > 0) {
    lines.push("");
    for (const observation of report.unexpectedObservations) {
      lines.push(
        `unexpected observation ${observation.provider} ${observation.identifier} at ${observation.file}:${observation.line}: ${observation.detail}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
