// GENERATED FILE — do not edit. Regenerate with the relay snapshot tool.
// A generated snapshot of the drafting endpoint probe used for release-note
// regression diffs. The provider-looking request below is generated output
// with an inert explicit key parameter and never executes; the generated
// source path is deliberately excluded from scanning by policy, so the
// reviewed expectation is file exclusion rather than any observation.

// generated-snapshot-request
export async function snapshotDraftEndpoint(apiKey: string): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      input: "snapshot probe",
      store: false
    })
  });
  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`);
  }
  return response.json();
}
