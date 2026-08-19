#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { checkSourceAnchors } from "./anchors.js";
import { compareReports, formatComparison } from "./compare.js";
import { validateReport } from "./report.js";
import { validateManifest } from "./schema.js";

const USAGE = [
  "usage:",
  "  coverage-oracle validate <manifest.json>",
  "  coverage-oracle validate-report <report.json>",
  "  coverage-oracle compare <manifest.json> <report.json> [--json]"
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
  json: boolean;
} | null {
  const command = args[0];
  if (command === "validate" || command === "validate-report") {
    if (args.length !== 2) {
      return null;
    }
    return { command, inputFile: args[1] as string, json: false };
  }
  if (command === "compare") {
    if (args.length === 3) {
      return {
        command,
        inputFile: args[1] as string,
        reportFile: args[2] as string,
        json: false
      };
    }
    if (args.length === 4 && args[3] === "--json") {
      return {
        command,
        inputFile: args[1] as string,
        reportFile: args[2] as string,
        json: true
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
  const { command, inputFile, reportFile, json } = parsed;

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
    process.stdout.write(
      `valid: ${inputFile} (${result.manifest.scenarios.length} scenarios)\n`
    );
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
