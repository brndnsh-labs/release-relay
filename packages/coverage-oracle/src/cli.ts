#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { checkSourceAnchors } from "./anchors.js";
import { compareReports, formatComparison } from "./compare.js";
import { normalizeSnapshot } from "./normalize.js";
import { validateReport } from "./report.js";
import { checkRevisionAnchors } from "./revision.js";
import { validateManifest } from "./schema.js";

const USAGE = [
  "usage:",
  "  coverage-oracle validate <manifest.json> [--check-revision]",
  "  coverage-oracle validate-report <report.json>",
  "  coverage-oracle compare <manifest.json> <report.json> [--json]",
  "  coverage-oracle normalize <manifest.json> <breakscope-snapshot.json> --breakscope-revision <full-sha> [--output <path>]"
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
  breakscopeRevision?: string;
  output?: string;
  json: boolean;
  checkRevision: boolean;
} | null {
  const command = args[0];
  if (command === "validate") {
    if (args.length === 2) {
      return {
        command,
        inputFile: args[1] as string,
        json: false,
        checkRevision: false
      };
    }
    if (args.length === 3 && args[2] === "--check-revision") {
      return {
        command,
        inputFile: args[1] as string,
        json: false,
        checkRevision: true
      };
    }
    return null;
  }
  if (command === "validate-report") {
    if (args.length !== 2) return null;
    return { command, inputFile: args[1] as string, json: false, checkRevision: false };
  }
  if (command === "compare") {
    if (args.length === 3) {
      return {
        command,
        inputFile: args[1] as string,
        reportFile: args[2] as string,
        json: false,
        checkRevision: false
      };
    }
    if (args.length === 4 && args[3] === "--json") {
      return {
        command,
        inputFile: args[1] as string,
        reportFile: args[2] as string,
        json: true,
        checkRevision: false
      };
    }
    return null;
  }
  if (command === "normalize") {
    if (args.length < 5) return null;
    const manifest = args[1] as string;
    const snapshot = args[2] as string;
    if (args[3] !== "--breakscope-revision") return null;
    const rev = args[4] as string;
    if (args.length === 5) {
      return {
        command,
        inputFile: manifest,
        snapshotFile: snapshot,
        breakscopeRevision: rev,
        json: false,
        checkRevision: false
      };
    }
    if (args.length === 7 && args[5] === "--output") {
      return {
        command,
        inputFile: manifest,
        snapshotFile: snapshot,
        breakscopeRevision: rev,
        output: args[6] as string,
        json: false,
        checkRevision: false
      };
    }
    return null;
  }
  return null;
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const { command, inputFile, reportFile, json, checkRevision } = parsed;

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
    const anchorErrors = await checkSourceAnchors(result.manifest, process.cwd());
    if (anchorErrors.length > 0) {
      for (const error of anchorErrors) {
        process.stderr.write(`error: ${error}\n`);
      }
      return 1;
    }
    if (checkRevision) {
      const revisionErrors = await checkRevisionAnchors(result.manifest, process.cwd());
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
    const snapshotFile = parsed.snapshotFile as string;
    const breakscopeRevision = parsed.breakscopeRevision as string;
    const output = parsed.output as string | undefined;
    const snapshotJson = await readJson(snapshotFile);
    if (!snapshotJson.ok) {
      process.stderr.write(`${snapshotJson.error}\n`);
      return 1;
    }
    const normalized = await normalizeSnapshot(
      result.manifest,
      snapshotJson.input,
      breakscopeRevision,
      process.cwd()
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

  const reportJson = await readJson(reportFile ?? "");
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

  const comparison = await compareReports(
    result.manifest,
    reportResult.report,
    process.cwd()
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
