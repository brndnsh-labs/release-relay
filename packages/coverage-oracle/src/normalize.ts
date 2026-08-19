import { type ScanReportV2, validateReport } from "./report.js";
import { checkSourceRoot, getHeadCommit } from "./revision.js";
import type { OracleManifest } from "./schema.js";
import { mapConfidence, validateSnapshot } from "./snapshot.js";

export type NormalizeResult =
  | { ok: true; report: ScanReportV2 }
  | { ok: false; errors: string[] };

export async function normalizeSnapshot(
  manifest: OracleManifest,
  snapshotInput: unknown,
  breakscopeRevisionFlag: string,
  rootDir: string
): Promise<NormalizeResult> {
  const errors: string[] = [];

  const snapshotResult = validateSnapshot(snapshotInput);
  if (!snapshotResult.ok) return { ok: false, errors: snapshotResult.errors };
  const snapshot = snapshotResult.snapshot;

  const FULL_SHA = /^[0-9a-f]{40}$/;
  if (!FULL_SHA.test(breakscopeRevisionFlag)) {
    return {
      ok: false,
      errors: ["--breakscope-revision must be a full 40-character git commit SHA"]
    };
  }
  if (breakscopeRevisionFlag !== snapshot.breakscopeRevision) {
    return {
      ok: false,
      errors: [
        `--breakscope-revision ${breakscopeRevisionFlag} does not match snapshot.breakscopeRevision ${snapshot.breakscopeRevision}`
      ]
    };
  }

  if (snapshot.releaseRelayRevision !== manifest.revision) {
    return {
      ok: false,
      errors: [
        `snapshot.releaseRelayRevision ${snapshot.releaseRelayRevision} does not match manifest.revision ${manifest.revision}`
      ]
    };
  }

  const sourceRootErrors = checkSourceRoot(rootDir, { requireClean: true });
  if (sourceRootErrors.length > 0) {
    return { ok: false, errors: sourceRootErrors };
  }

  const head = getHeadCommit(rootDir);
  if (head === null) {
    return { ok: false, errors: [`could not resolve HEAD in ${rootDir}`] };
  }
  if (head !== manifest.revision) {
    return {
      ok: false,
      errors: [
        `manifest.revision ${manifest.revision} does not match HEAD ${head}; checkout the pinned revision before normalizing`
      ]
    };
  }

  if (snapshot.scan.status !== "completed") {
    return {
      ok: false,
      errors: [`snapshot.scan.status ${snapshot.scan.status} is not completed`]
    };
  }

  const snapshotFiles = new Map(snapshot.files.map((file) => [file.file, file]));
  for (const scenario of manifest.scenarios) {
    if (!snapshotFiles.has(scenario.source.file)) {
      errors.push(
        `snapshot.files missing disposition for manifest file ${scenario.source.file} (scenario ${scenario.id})`
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // The report is observation-centric: preserve all validated detector evidence
  // without requiring an oracle anchor or expectation match.
  const reportObservations: ScanReportV2["observations"] = [];
  for (const [index, snapObs] of snapshot.observations.entries()) {
    const file = snapshotFiles.get(snapObs.file);
    if (file === undefined) {
      errors.push(
        `snapshot.observations[${index}] references ${snapObs.file}, which has no file disposition`
      );
      continue;
    }
    if (file.disposition !== "scanned") {
      errors.push(
        `snapshot.observations[${index}] references ${snapObs.file}, which is declared ${file.disposition}`
      );
      continue;
    }
    const mapped = mapConfidence(snapObs.confidence, snapshot.ruleset);
    if (!mapped.ok) {
      errors.push(mapped.error);
      continue;
    }
    reportObservations.push({
      file: snapObs.file,
      lineStart: snapObs.lineStart,
      lineEnd: snapObs.lineEnd,
      provider: snapObs.provider,
      identifier: snapObs.identifier,
      evidenceKind: snapObs.evidenceKind,
      confidence: mapped.band
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  // Build report files sorted deterministically
  const reportFiles = [...snapshot.files]
    .map((f) => ({
      file: f.file,
      disposition: f.disposition as ScanReportV2["files"][number]["disposition"],
      ...(f.reason ? { reason: f.reason } : {})
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  reportObservations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
    if (a.lineEnd !== b.lineEnd) return a.lineEnd - b.lineEnd;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    if (a.identifier !== b.identifier) return a.identifier.localeCompare(b.identifier);
    if (a.evidenceKind !== b.evidenceKind)
      return a.evidenceKind.localeCompare(b.evidenceKind);
    return a.confidence.localeCompare(b.confidence);
  });

  const report: ScanReportV2 = {
    reportVersion: 2,
    manifestVersion: 1,
    releaseRelayRevision: snapshot.releaseRelayRevision,
    breakscopeRevision: snapshot.breakscopeRevision,
    ruleset: snapshot.ruleset,
    files: reportFiles as ScanReportV2["files"],
    observations: reportObservations
  };

  const validated = validateReport(report);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  // Determinism check: ensure stable ordering already done

  return { ok: true, report };
}
