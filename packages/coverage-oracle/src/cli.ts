#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { checkSourceAnchors } from "./anchors.js";
import { validateManifest } from "./schema.js";

async function main(): Promise<number> {
  const [command, file] = process.argv.slice(2);
  if (command !== "validate" || !file) {
    process.stderr.write("usage: coverage-oracle validate <manifest.json>\n");
    return 1;
  }

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    process.stderr.write(`error: could not read ${file}\n`);
    return 1;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`error: invalid JSON in ${file}: ${String(error)}\n`);
    return 1;
  }

  const result = validateManifest(input);
  if (!result.ok) {
    for (const error of result.errors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }

  const anchorErrors = await checkSourceAnchors(result.manifest, process.cwd());
  if (anchorErrors.length > 0) {
    for (const error of anchorErrors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }

  process.stdout.write(
    `valid: ${file} (${result.manifest.scenarios.length} scenarios)\n`
  );
  return 0;
}

process.exitCode = await main();
