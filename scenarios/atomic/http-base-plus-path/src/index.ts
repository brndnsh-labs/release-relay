// A maintainer tool that reviews a short release summary through a raw
// Messages endpoint request assembled from a fixed base host plus a path
// suffix, rather than through the official SDK or Release Relay's injected
// adapter. The version header matches the value the installed SDK itself
// sends, the input is an inert summary the maintainer already wrote, and
// the API key is an explicit parameter, never read from the environment.
// This workspace compiles only and is never invoked, so the request can
// never execute.

const messagesHost = "https://api.anthropic.com";

// base-path-review-request
export async function reviewViaMessagesEndpoint(
  apiKey: string,
  summary: string
): Promise<string> {
  const response = await fetch(messagesHost + "/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: summary }]
    })
  });
  if (!response.ok) {
    throw new Error(`Messages request failed: ${response.status}`);
  }
  const payload = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const first = payload.content?.[0];
  return first !== undefined && first.type === "text" ? (first.text ?? "") : "";
}
