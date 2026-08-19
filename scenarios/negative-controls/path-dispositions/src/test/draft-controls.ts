import { OpenAI } from "openai";

// A control case for the drafting workflow placed deliberately under a test
// path. The SDK usage is real and correctly attributed, but the source-path
// policy demotes test paths below the alertable band, so the reviewed
// expectation is a demoted observation. The API key is an explicit
// parameter, never read from the environment, and no test runner executes
// this file: the workspace compiles only.

// test-path-draft-control
export async function controlDraftOutput(apiKey: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5.6",
    instructions: "Return the fixed control summary.",
    input: "fixed control input",
    store: false
  });
  return response.output_text;
}
