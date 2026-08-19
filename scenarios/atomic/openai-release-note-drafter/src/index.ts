import { OpenAI } from "openai";

// A maintainer tool that drafts a short release-note summary through a
// direct Responses client, rather than through Release Relay's injected
// adapter (packages/openai-integration). The bounded input is a small array
// of plain bullet-point strings the maintainer already wrote; there is no
// real prompt content, and the API key is an explicit parameter, never read
// from the environment. This workspace compiles only and is never invoked.

export interface ReleaseNoteBulletPoint {
  sourceIdentity: string;
  summary: string;
}

// release-note-draft-client
export async function draftReleaseNoteSummary(
  apiKey: string,
  bulletPoints: readonly ReleaseNoteBulletPoint[]
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.6",
    instructions:
      "Combine the supplied bullet points into one short paragraph. Do not " +
      "invent a change that is not present in the input.",
    input: JSON.stringify(bulletPoints),
    store: false
  });
  return response.output_text;
}
