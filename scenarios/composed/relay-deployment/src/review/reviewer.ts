import type { Anthropic } from "@anthropic-ai/sdk";

// The composed deployment's review module. It owns no construction: the
// Messages client is constructed in the composition root (src/relay.ts) and
// dependency-injected here as the `api` parameter. The call site reaches the
// messages namespace through bracket access, varying the call-expression
// shape from the dot-access forms in the atomic scenarios and the product
// adapter. This workspace compiles only and is never invoked.

// reviewer-messages-client
export async function reviewDraft(api: Anthropic, draft: string): Promise<string> {
  const response = await api["messages"].create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system:
      "State whether every claim in the supplied release draft is grounded " +
      "in the draft text itself. Do not invent a change that is not present.",
    messages: [{ role: "user", content: draft }]
  });
  const first = response.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}
