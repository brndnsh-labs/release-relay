// Vendored from relay-legacy-client@0.4.2; kept unmodified for reference
// until the dashboard migration finishes. The legacy provider-looking
// request below carries an inert explicit key parameter and never executes,
// and the vendored source path is deliberately excluded from scanning by
// policy, so the reviewed expectation is file exclusion rather than any
// observation.

// vendor-legacy-request
export async function legacyDraftRequest(apiKey: string): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: "legacy probe"
    })
  });
  if (!response.ok) {
    throw new Error(`Legacy request failed: ${response.status}`);
  }
  return response.json();
}
