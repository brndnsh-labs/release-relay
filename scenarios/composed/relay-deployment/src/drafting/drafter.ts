import { OpenAI } from "openai";

// The composed deployment's drafting module. It is consumed through its
// default export, constructs its own Responses client from an explicit API
// key parameter (never read from the environment), and unwraps the optional
// binding through a small non-null wrapper so a missing key fails loudly
// before any request is prepared. The unwrapped binding deliberately reuses
// the `api` name also bound in the review module and the internal status
// reader, so name-based attribution has to stay file-scoped. This workspace
// compiles only and is never invoked.

export interface DraftBulletPoint {
  sourceIdentity: string;
  summary: string;
}

function expectConfigured<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`Missing required configuration: ${field}`);
  }
  return value;
}

// drafter-responses-client
export default async function draftReleaseBody(
  apiKey: string | undefined,
  bulletPoints: readonly DraftBulletPoint[]
): Promise<string> {
  const client = apiKey === undefined ? undefined : new OpenAI({ apiKey });
  const api = expectConfigured(client, "drafting apiKey");
  const response = await api.responses.create({
    model: "gpt-5.6",
    instructions:
      "Combine the supplied bullet points into one short release body. " +
      "Do not invent a change that is not present in the input.",
    input: JSON.stringify(bulletPoints),
    store: false
  });
  return response.output_text;
}
