import { spawnSync } from "node:child_process";
import { getHeadCommit } from "./revision.js";
import { validateReport, type ScanReport } from "./report.js";
import type { OracleManifest } from "./schema.js";
import { mapConfidence, validateSnapshot } from "./snapshot.js";

function findAnchorLine(
  content: string,
  anchor: string
): { line: number } | { error: string } {
  const occurrences = content.split(anchor).length - 1;
  if (occurrences === 0) return { error: "was not found" };
  if (occurrences > 1)
    return { error: `appears ${occurrences} times; expected exactly one` };
  const index = content.indexOf(anchor);
  return { line: content.slice(0, index).split("\n").length };
}

async function readFileAtRevision(
  revision: string,
  file: string,
  rootDir: string
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const r = spawnSync("git", ["show", `${revision}:${file}`], {
    cwd: rootDir,
    encoding: "utf8"
  });
  if (r.status !== 0)
    return {
      ok: false,
      error:
        typeof r.stderr === "string"
          ? r.stderr.trim()
          : `could not read ${file} at ${revision}`
    };
  return { ok: true, content: typeof r.stdout === "string" ? r.stdout : "" };
}

export type NormalizeResult =
  | { ok: true; report: ScanReport }
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

  // Check every manifest file has disposition
  const snapshotFiles = new Map(snapshot.files.map((f) => [f.file, f]));
  for (const scenario of manifest.scenarios) {
    const file = scenario.source.file;
    if (!snapshotFiles.has(file)) {
      errors.push(
        `snapshot.files missing disposition for manifest file ${file} (scenario ${scenario.id})`
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Resolve anchors at pinned revision
  const anchorLines = new Map<string, number>();
  for (const scenario of manifest.scenarios) {
    const read = await readFileAtRevision(
      manifest.revision,
      scenario.source.file,
      rootDir
    );
    if (!read.ok) {
      errors.push(
        `${scenario.id}: source file ${scenario.source.file} not found in revision ${manifest.revision}`
      );
      continue;
    }
    const found = findAnchorLine(read.content, scenario.source.anchor);
    if ("error" in found) {
      errors.push(
        `${scenario.id}: anchor ${scenario.source.anchor} ${found.error} in ${scenario.source.file} at revision ${manifest.revision}`
      );
      continue;
    }
    anchorLines.set(scenario.id, found.line);
  }
  if (errors.length > 0) return { ok: false, errors };

  // Build map from file -> scenarios
  const scenariosByFile = new Map<string, typeof manifest.scenarios>();
  for (const s of manifest.scenarios) {
    const arr = scenariosByFile.get(s.source.file) ?? [];
    arr.push(s);
    scenariosByFile.set(s.source.file, arr);
  }

  // For each snapshot observation, find covering scenario(s)
  // We need to detect ambiguous (covers multiple anchors) and unmatched
  const observationMatches = new Map<number, string[]>(); // snapshot index -> scenario ids that it covers
  for (const [idx, obs] of snapshot.observations.entries()) {
    const candidates: string[] = [];
    const fileScenarios = scenariosByFile.get(obs.file) ?? [];
    for (const scen of fileScenarios) {
      const line = anchorLines.get(scen.id);
      if (line !== undefined && obs.lineStart <= line && line <= obs.lineEnd) {
        candidates.push(scen.id);
      }
    }
    if (candidates.length === 0) {
      errors.push(
        `snapshot.observations[${idx}] at ${obs.file}:${obs.lineStart}-${obs.lineEnd} does not cover any manifest anchor line`
      );
    } else if (candidates.length > 1) {
      errors.push(
        `snapshot.observations[${idx}] at ${obs.file}:${obs.lineStart}-${obs.lineEnd} is ambiguous, covers multiple anchors: ${candidates.join(", ")}`
      );
    } else {
      observationMatches.set(idx, candidates);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // For each scenario that expects observation/demoted, ensure exactly one snapshot observation covers it
  // For no-observation/excluded/uncertain, ensure zero
  const scenarioToSnapshot = new Map<string, number>();
  for (const [snapIdx, scenIds] of observationMatches) {
    const scenId = scenIds[0] as string;
    if (scenarioToSnapshot.has(scenId)) {
      errors.push(
        `manifest scenario ${scenId} is covered by multiple snapshot observations (ambiguous)`
      );
    } else {
      scenarioToSnapshot.set(scenId, snapIdx);
    }
  }

  for (const scenario of manifest.scenarios) {
    const hasObservation = scenario.expectations.some(
      (e) => e.outcome === "observation" || e.outcome === "demoted"
    );
    const hasNoObservation = scenario.expectations.some(
      (e) => e.outcome === "no-observation"
    );
    const hasExcluded = scenario.expectations.some((e) => e.outcome === "excluded");
    const hasUncertain = scenario.expectations.some((e) => e.outcome === "uncertain");
    const matched = scenarioToSnapshot.has(scenario.id);

    if (hasObservation) {
      if (!matched) {
        errors.push(
          `snapshot missing observation for ${scenario.id} at ${scenario.source.file}:${anchorLines.get(scenario.id)} (expected ${scenario.expectations
            .filter((e) => e.outcome === "observation" || e.outcome === "demoted")
            .map((e) => `${e.provider} ${e.identifier}`)
            .join(", ")})`
        );
      }
    } else if (hasNoObservation || hasExcluded || hasUncertain) {
      if (matched) {
        errors.push(
          `snapshot has unexpected observation for ${scenario.id} which expects ${scenario.expectations[0]?.outcome} (no observation should cover its anchor)`
        );
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Build report observations from matched snapshot observations
  const reportObservations: ScanReport["observations"] = [];
  for (const scenario of manifest.scenarios) {
    const snapIdx = scenarioToSnapshot.get(scenario.id);
    if (snapIdx === undefined) continue; // no-observation etc.
    const snapObs = snapshot.observations[
      snapIdx
    ] as (typeof snapshot.observations)[number];
    const mapped = mapConfidence(snapObs.confidence, snapshot.ruleset);
    if (!mapped.ok) {
      errors.push(mapped.error);
      continue;
    }
    // Find the expectation that corresponds to this snapshot observation (provider/identifier)
    const expectation = scenario.expectations.find(
      (e) => e.provider === snapObs.provider && e.identifier === snapObs.identifier
    );
    if (expectation === undefined) {
      errors.push(
        `snapshot observation ${snapObs.provider} ${snapObs.identifier} at ${snapObs.file}:${snapObs.lineStart}-${snapObs.lineEnd} does not match any expectation for scenario ${scenario.id}`
      );
      continue;
    }
    reportObservations.push({
      file: scenario.source.file,
      anchor: scenario.source.anchor,
      line: anchorLines.get(scenario.id) as number,
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
      disposition: f.disposition as ScanReport["files"][number]["disposition"],
      ...(f.reason ? { reason: f.reason } : {})
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  reportObservations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.anchor !== b.anchor) return a.anchor.localeCompare(b.anchor);
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.identifier.localeCompare(b.identifier);
  });

  const report: ScanReport = {
    reportVersion: 1,
    manifestVersion: 1,
    releaseRelayRevision: snapshot.releaseRelayRevision,
    breakscopeRevision: snapshot.breakscopeRevision,
    ruleset: snapshot.ruleset,
    files: reportFiles as ScanReport["files"],
    observations: reportObservations
  };

  const validated = validateReport(report);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  // Determinism check: ensure stable ordering already done

  return { ok: true, report };
}
