import { Anthropic } from "@anthropic-ai/sdk";

// A maintainer tool that reviews a short release-note summary through a
// direct Messages client, rather than through Release Relay's injected
// adapter (packages/anthropic-integration). The narrow input is a single
// summary string the maintainer already wrote; there is no real repository
// content, and the API key is an explicit parameter, never read from the
// environment. This workspace compiles only and is never invoked.

// draft-review-client
export async function reviewReleaseNoteSummary(
  apiKey: string,
  summary: string
): Promise<{ content: unknown }> {
  const client = new Anthropic({ apiKey });
  return client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    system:
      "Point out any claim in the supplied release-note summary that is not " +
      "grounded in the text itself. Do not invent a change that is not present.",
    messages: [{ role: "user", content: summary }]
  });
}
