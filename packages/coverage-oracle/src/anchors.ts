import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OracleManifest } from "./schema.js";

export async function checkSourceAnchors(
  manifest: OracleManifest,
  rootDir: string
): Promise<string[]> {
  const errors: string[] = [];
  for (const scenario of manifest.scenarios) {
    const { file, anchor } = scenario.source;
    let content: string;
    try {
      content = await readFile(resolve(rootDir, file), "utf8");
    } catch {
      errors.push(`${scenario.id}: source file ${file} could not be read`);
      continue;
    }
    const occurrences = content.split(anchor).length - 1;
    if (occurrences === 0) {
      errors.push(`${scenario.id}: anchor ${anchor} not found in ${file}`);
    } else if (occurrences > 1) {
      errors.push(
        `${scenario.id}: anchor ${anchor} appears ${occurrences} times in ${file}; expected exactly one`
      );
    }
  }
  return errors;
}
