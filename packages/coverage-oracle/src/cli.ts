#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { checkSourceAnchors } from "./anchors.js";
import { compareReports, formatComparison } from "./compare.js";
import { normalizeSnapshot } from "./normalize.js";
import { validateReport } from "./report.js";
import { checkRevisionAnchors, checkSourceRoot, getHeadCommit } from "./revision.js";
import { validateManifest } from "./schema.js";

const USAGE = [
  "usage:",
  "  coverage-oracle validate <manifest.json> --source-root <path> [--check-revision]",
  "  coverage-oracle validate-report <report.json>",
  "  coverage-oracle compare <manifest.json> <report.json> --source-root <path> [--json]",
  "  coverage-oracle normalize <manifest.json> <breakscope-snapshot.json> --breakscope-revision <full-sha> --source-root <path> [--output <path>]"
].join("\n");

async function readJson(
  file: string
): Promise<{ ok: true; input: unknown } | { ok: false; error: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { ok: false, error: `error: could not read ${file}` };
  }
  try {
    return { ok: true, input: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `error: invalid JSON in ${file}: ${String(error)}`
    };
  }
}

function parseArgs(args: string[]): {
  command: string;
  inputFile: string;
  reportFile?: string;
  snapshotFile?: string;
  breakscopeRevision?: string | undefined;
  output?: string | undefined;
  sourceRoot?: string | undefined;
  json: boolean;
  checkRevision: boolean;
} | null {
  const command = args[0];
  const parseOptions = (
    optionArgs: string[]
  ): {
    sourceRoot?: string | undefined;
    output?: string | undefined;
    breakscopeRevision?: string | undefined;
    json: boolean;
    checkRevision: boolean;
  } | null => {
    let sourceRoot: string | undefined;
    let output: string | undefined;
    let breakscopeRevision: string | undefined;
    let json = false;
    let checkRevision = false;
    for (let index = 0; index < optionArgs.length; index += 1) {
      const option = optionArgs[index];
      if (
        option === "--source-root" ||
        option === "--output" ||
        option === "--breakscope-revision"
      ) {
        const value = optionArgs[index + 1];
        if (value === undefined || value.startsWith("--")) return null;
        index += 1;
        if (option === "--source-root") sourceRoot = value;
        else if (option === "--output") output = value;
        else breakscopeRevision = value;
      } else if (option === "--json") {
        if (json) return null;
        json = true;
      } else if (option === "--check-revision") {
        if (checkRevision) return null;
        checkRevision = true;
      } else {
        return null;
      }
    }
    return { sourceRoot, output, breakscopeRevision, json, checkRevision };
  };

  if (command === "validate") {
    const options = parseOptions(args.slice(2));
    if (
      options === null ||
      options.json ||
      options.output !== undefined ||
      options.breakscopeRevision !== undefined
    )
      return null;
    if (options.sourceRoot === undefined) return null;
    if (args[1] === undefined) return null;
    const inputFile: string = args[1];
    return { command, inputFile, ...options };
  }
  if (command === "validate-report") {
    if (args.length !== 2) return null;
    if (args[1] === undefined) return null;
    const inputFile: string = args[1];
    return { command, inputFile, json: false, checkRevision: false };
  }
  if (command === "compare") {
    const options = parseOptions(args.slice(3));
    if (
      options === null ||
      options.checkRevision ||
      options.output !== undefined ||
      options.breakscopeRevision !== undefined ||
      options.sourceRoot === undefined
    )
      return null;
    if (args[1] === undefined || args[2] === undefined) return null;
    const inputFile: string = args[1];
    const reportFile: string = args[2];
    return {
      command,
      inputFile,
      reportFile,
      ...options
    };
  }
  if (command === "normalize") {
    if (args.length < 3) return null;
    if (args[1] === undefined || args[2] === undefined) return null;
    const manifest: string = args[1];
    const snapshot: string = args[2];
    const options = parseOptions(args.slice(3));
    if (
      options === null ||
      options.json ||
      options.checkRevision ||
      options.breakscopeRevision === undefined ||
      options.sourceRoot === undefined
    )
      return null;
    return { command, inputFile: manifest, snapshotFile: snapshot, ...options };
  }
  return null;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const { command, inputFile, reportFile, json, checkRevision, sourceRoot } = parsed;

  const jsonInput = await readJson(inputFile);
  if (!jsonInput.ok) {
    process.stderr.write(`${jsonInput.error}\n`);
    return 1;
  }

  if (command === "validate-report") {
    const result = validateReport(jsonInput.input);
    if (!result.ok) {
      for (const error of result.errors) {
        process.stderr.write(`error: ${error}\n`);
      }
      return 1;
    }
    process.stdout.write(
      `valid report: ${inputFile} (${result.report.observations.length} observations, ${result.report.files.length} files)\n`
    );
    return 0;
  }

  const result = validateManifest(jsonInput.input);
  if (!result.ok) {
    for (const error of result.errors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }

  if (command === "validate") {
    if (sourceRoot === undefined) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }
    const sourceRootErrors = checkSourceRoot(sourceRoot, {
      requireClean: checkRevision
    });
    if (sourceRootErrors.length > 0) {
      for (const error of sourceRootErrors) process.stderr.write(`error: ${error}\n`);
      return 1;
    }
    const anchorErrors = await checkSourceAnchors(result.manifest, sourceRoot);
    if (anchorErrors.length > 0) {
      for (const error of anchorErrors) {
        process.stderr.write(`error: ${error}\n`);
      }
      return 1;
    }
    if (checkRevision) {
      const revisionErrors = await checkRevisionAnchors(result.manifest, sourceRoot);
      if (revisionErrors.length > 0) {
        for (const error of revisionErrors) {
          process.stderr.write(`error: ${error}\n`);
        }
        return 1;
      }
    }
    process.stdout.write(
      `valid: ${inputFile} (${result.manifest.scenarios.length} scenarios)\n`
    );
    return 0;
  }

  if (command === "normalize") {
    const snapshotFile = parsed.snapshotFile;
    const breakscopeRevision = parsed.breakscopeRevision;
    const output = parsed.output;
    if (
      snapshotFile === undefined ||
      breakscopeRevision === undefined ||
      sourceRoot === undefined
    ) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }
    const snapshotJson = await readJson(snapshotFile);
    if (!snapshotJson.ok) {
      process.stderr.write(`${snapshotJson.error}\n`);
      return 1;
    }
    const normalized = await normalizeSnapshot(
      result.manifest,
      snapshotJson.input,
      breakscopeRevision,
      sourceRoot
    );
    if (!normalized.ok) {
      for (const error of normalized.errors) {
        process.stderr.write(`error: ${error}\n`);
      }
      return 1;
    }
    const outputJson = `${JSON.stringify(normalized.report, null, 2)}\n`;
    if (output !== undefined) {
      try {
        await writeFile(output, outputJson, "utf8");
      } catch {
        process.stderr.write(`error: could not write ${output}\n`);
        return 1;
      }
    } else {
      process.stdout.write(outputJson);
    }
    return 0;
  }

  if (reportFile === undefined || sourceRoot === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const reportJson = await readJson(reportFile);
  if (!reportJson.ok) {
    process.stderr.write(`${reportJson.error}\n`);
    return 1;
  }
  const reportResult = validateReport(reportJson.input);
  if (!reportResult.ok) {
    for (const error of reportResult.errors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }
  if (reportResult.report.reportVersion !== 1) {
    process.stderr.write(
      "error: compare does not yet support reportVersion 2; use validate-report or wait for the v2 comparator\n"
    );
    return 1;
  }

  const sourceRootErrors = checkSourceRoot(sourceRoot, {
    requireClean: true
  });
  if (sourceRootErrors.length > 0) {
    for (const error of sourceRootErrors) process.stderr.write(`error: ${error}\n`);
    return 1;
  }
  const head = getHeadCommit(sourceRoot);
  if (head === null) {
    process.stderr.write(`error: could not resolve HEAD in ${sourceRoot}\n`);
    return 1;
  }
  if (head !== result.manifest.revision) {
    process.stderr.write(
      `error: manifest.revision ${result.manifest.revision} does not match HEAD ${head}; checkout the pinned revision before comparing\n`
    );
    return 1;
  }

  const comparison = await compareReports(
    result.manifest,
    reportResult.report,
    sourceRoot
  );
  if (!comparison.ok) {
    for (const error of comparison.errors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(comparison.report, null, 2)}\n`);
  } else {
    process.stdout.write(formatComparison(comparison.report));
  }
  return comparison.report.ok ? 0 : 1;
}

process.exitCode = await main();
