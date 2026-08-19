import { Anthropic } from "@anthropic-ai/sdk";

// A same-provider negative: a maintainer utility that calls the official
// Anthropic SDK for an operation outside Release Relay's documented product
// workflow (a structured draft review or alternate draft through the
// Messages create endpoint). Estimating the token budget for a prompt
// before it is sent is real, correctly attributed Anthropic API usage that
// should not be conflated with the review call site in
// scenarios/atomic/anthropic-draft-reviewer. This workspace compiles only
// and is never invoked or given a real API key.

// unrelated-negative-count-client
export async function estimatePromptTokenBudget(
  apiKey: string,
  draftSummary: string
): Promise<number> {
  const client = new Anthropic({ apiKey });
  const result = await client.messages.countTokens({
    model: "claude-opus-5",
    messages: [{ role: "user", content: draftSummary }]
  });
  return result.input_tokens;
}
