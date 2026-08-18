import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repositoryPhase, supportedProviders } from "./index.js";

const requiredDocuments = [
  "docs/spec.md",
  "docs/architecture.md",
  "docs/api-coverage.md",
  "docs/oracle.md",
  "docs/security.md",
  "docs/roadmap.md"
] as const;

test("the bootstrap stays explicitly spec-first", () => {
  assert.equal(repositoryPhase, "specification");
  assert.deepEqual(supportedProviders, ["github", "openai", "anthropic", "stripe"]);
});

test("every required contract document is present and substantive", async () => {
  for (const path of requiredDocuments) {
    const content = await readFile(path, "utf8");
    assert.match(content, /^# /);
    assert.ok(content.length > 1_000, `${path} is unexpectedly thin`);
  }
});
