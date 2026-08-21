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

export interface ManifestAnchorRef {
  owner: string;
  file: string;
  anchor: string;
}

/**
 * Every anchor the manifest pins: one scenario-level source anchor per
 * scenario, plus a per-expectation location anchor on every observation and
 * demoted expectation in manifest version 2.
 */
export function collectManifestAnchors(manifest: OracleManifest): ManifestAnchorRef[] {
  const refs: ManifestAnchorRef[] = [];
  for (const scenario of manifest.scenarios) {
    refs.push({
      owner: scenario.id,
      file: scenario.source.file,
      anchor: scenario.source.anchor
    });
    if (manifest.version !== 2) continue;
    for (const expectation of scenario.expectations) {
      if (expectation.locationAnchor === undefined) continue;
      refs.push({
        owner: expectation.id ?? `${scenario.id}.unidentified`,
        file: expectation.locationAnchor.file,
        anchor: expectation.locationAnchor.anchor
      });
    }
  }
  return refs;
}

export async function checkSourceAnchors(
  manifest: OracleManifest,
  rootDir: string
): Promise<string[]> {
  const errors: string[] = [];
  // Cached file content; null marks a failed or unresolvable read so every
  // anchor referencing the file reports instead of silently skipping.
  const contentCache = new Map<string, string | null>();
  for (const ref of collectManifestAnchors(manifest)) {
    const sourcePath = await resolveSourceFile(rootDir, ref.file);
    if (sourcePath === null) {
      errors.push(`${ref.owner}: source file ${ref.file} is outside source root`);
      continue;
    }
    let content = contentCache.get(ref.file);
    if (content === undefined) {
      try {
        content = await readFile(sourcePath, "utf8");
        contentCache.set(ref.file, content);
      } catch {
        contentCache.set(ref.file, null);
        content = null;
      }
    }
    if (content === null) {
      errors.push(`${ref.owner}: source file ${ref.file} could not be read`);
      continue;
    }
    const occurrences = content.split(ref.anchor).length - 1;
    if (occurrences === 0) {
      errors.push(`${ref.owner}: anchor ${ref.anchor} not found in ${ref.file}`);
    } else if (occurrences > 1) {
      errors.push(
        `${ref.owner}: anchor ${ref.anchor} appears ${occurrences} times in ${ref.file}; expected exactly one`
      );
    }
  }
  return errors;
}
