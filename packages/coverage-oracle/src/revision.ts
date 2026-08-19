import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { OracleManifest } from "./schema.js";

function git(
  args: string[],
  cwd: string
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : ""
  };
}

export interface SourceRootOptions {
  requireClean?: boolean;
}

/**
 * Validate the explicit source checkout boundary before any source or Git
 * reads. The path must be the repository root itself, not a subdirectory of
 * another checkout.
 */
export function checkSourceRoot(
  rootDir: string,
  options: SourceRootOptions = {}
): string[] {
  if (rootDir.trim() === "") {
    return ["--source-root must be a non-empty path"];
  }
  let isDirectory = false;
  try {
    isDirectory = existsSync(rootDir) && statSync(rootDir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    return [`source root ${rootDir} does not exist or is not a directory`];
  }

  const root = resolve(rootDir);
  const topLevelResult = git(["rev-parse", "--show-toplevel"], root);
  if (topLevelResult.status !== 0) {
    return [`source root ${rootDir} is not a git repository`];
  }
  const topLevel = resolve(topLevelResult.stdout.trim());
  if (topLevel !== root) {
    return [
      `source root ${rootDir} must be the repository root (git root is ${topLevel})`
    ];
  }

  if (options.requireClean) {
    const status = git(["status", "--porcelain", "--untracked-files=all"], root);
    if (status.status !== 0) {
      return [`could not inspect source root cleanliness in ${rootDir}`];
    }
    if (status.stdout.trim() !== "") {
      return [
        `source root ${rootDir} must be clean; uncommitted changes are not allowed`
      ];
    }
  }

  return [];
}

export function commitExists(revision: string, rootDir: string): boolean {
  const r = git(["cat-file", "-e", `${revision}^{commit}`], rootDir);
  return r.status === 0;
}

export function getHeadCommit(rootDir: string): string | null {
  const r = git(["rev-parse", "HEAD"], rootDir);
  if (r.status !== 0) return null;
  const head = r.stdout.trim();
  return head.length === 40 ? head : null;
}

export function readFileAtRevision(
  revision: string,
  file: string,
  rootDir: string
): { ok: true; content: string } | { ok: false; error: string } {
  const r = git(["show", `${revision}:${file}`], rootDir);
  if (r.status !== 0) {
    return {
      ok: false,
      error: r.stderr.trim() || `could not read ${file} at ${revision}`
    };
  }
  return { ok: true, content: r.stdout };
}

export async function checkRevisionAnchors(
  manifest: OracleManifest,
  rootDir: string
): Promise<string[]> {
  const rootErrors = checkSourceRoot(rootDir, { requireClean: true });
  if (rootErrors.length > 0) return rootErrors;

  const errors: string[] = [];
  const revision = manifest.revision;

  if (!commitExists(revision, rootDir)) {
    errors.push(
      `manifest.revision ${revision} does not exist locally as a commit; fetch or check the pinned revision without network access`
    );
    return errors;
  }

  const head = getHeadCommit(rootDir);
  if (head === null) {
    errors.push(
      `could not resolve HEAD in ${rootDir}; ensure the directory is a git repository`
    );
  } else if (head !== revision) {
    errors.push(
      `manifest.revision ${revision} does not match HEAD ${head}; the working tree must be checked out at the declared revision before a revision-aware validation`
    );
  }

  for (const scenario of manifest.scenarios) {
    const { file, anchor } = scenario.source;
    const read = readFileAtRevision(revision, file, rootDir);
    if (!read.ok) {
      errors.push(
        `${scenario.id}: source file ${file} not found in revision ${revision}`
      );
      continue;
    }
    const occurrences = read.content.split(anchor).length - 1;
    if (occurrences === 0) {
      errors.push(
        `${scenario.id}: anchor ${anchor} not found in ${file} at revision ${revision}`
      );
    } else if (occurrences > 1) {
      errors.push(
        `${scenario.id}: anchor ${anchor} appears ${occurrences} times in ${file} at revision ${revision}; expected exactly one`
      );
    }
  }

  return errors;
}
