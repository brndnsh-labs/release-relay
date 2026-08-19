import { spawnSync } from "node:child_process";
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
