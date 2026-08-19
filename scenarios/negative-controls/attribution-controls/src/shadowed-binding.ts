import type { Anthropic } from "@anthropic-ai/sdk";

// The imported provider class is referenced only in a type position, and an
// inner scope shadows its name with a plain version-label string, so a
// name-only match finds no provider client or call here. This is a
// deliberate shadowed-binding control: the import is real but no provider
// observation may be attributed to this file. This workspace compiles only
// and is never invoked.

export type ReviewClient = Anthropic;

// shadowed-name-label
export function reviewClientLabel(): string {
  const Anthropic = "review-panel-v1";
  return Anthropic;
}
