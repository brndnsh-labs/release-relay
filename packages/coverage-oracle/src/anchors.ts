import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { OracleManifest } from "./schema.js";

export async function resolveSourceFile(
  rootDir: string,
  file: string
): Promise<string | null> {
  if (isAbsolute(file)) return null;
  const root = resolve(rootDir);
  const path = resolve(root, file);
  const outside = relative(root, path);
  if (!(outside === "" || (!outside.startsWith("..") && !isAbsolute(outside)))) {
    return null;
  }

  let current = root;
  for (const segment of outside.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return null;
    } catch {
      // A missing path cannot resolve through a later symlink; leave the usual
      // read failure to report that the manifest source is absent.
      return path;
    }
  }
  return path;
}

export async function checkSourceAnchors(
  manifest: OracleManifest,
  rootDir: string
): Promise<string[]> {
  const errors: string[] = [];
  for (const scenario of manifest.scenarios) {
    const { file, anchor } = scenario.source;
    const sourcePath = await resolveSourceFile(rootDir, file);
    if (sourcePath === null) {
      errors.push(`${scenario.id}: source file ${file} is outside source root`);
      continue;
    }
    let content: string;
    try {
      content = await readFile(sourcePath, "utf8");
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
