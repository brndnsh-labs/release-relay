// A maintainer tool that drafts a short release body through a raw Responses
// endpoint request addressed by its full fixed URL, rather than through the
// official SDK or Release Relay's injected adapter. The example input is
// inert fixed text and the API key is an explicit parameter, never read from
// the environment. This workspace compiles only and is never invoked, so
// the request can never execute.

// full-url-draft-request
export async function draftViaResponsesEndpoint(
  apiKey: string,
  bulletPoints: readonly string[]
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      instructions:
        "Combine the supplied bullet points into one short release body. " +
        "Do not invent a change that is not present in the input.",
      input: JSON.stringify(bulletPoints),
      store: false
    })
  });
  if (!response.ok) {
    throw new Error(`Responses request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { output_text?: string };
  return payload.output_text ?? "";
}
