// A routing table of endpoint strings used for documentation and
// allowlisting in the release dashboard. It is pure data: no client is
// constructed and no request is ever issued from it. This is a deliberate
// lookup-table control: endpoint-looking strings in data do not constitute
// provider usage, so no provider observation may be attributed to this
// file. This workspace compiles only and is never invoked.

export interface CatalogEntry {
  operation: string;
  endpoint: string;
}

// endpoint-routing-catalog
export const endpointCatalog: readonly CatalogEntry[] = [
  {
    operation: "draft",
    endpoint: "https://api.openai.com/v1/responses"
  },
  {
    operation: "review",
    endpoint: "https://api.anthropic.com/v1/messages"
  },
  {
    operation: "portal",
    endpoint: "https://api.stripe.com/v1/billing_portal/sessions"
  },
  {
    operation: "compare",
    endpoint:
      "https://api.github.com/repos/release-relay/example/compare/v1.0.0...v1.1.0"
  }
];

export function catalogEntryFor(operation: string): CatalogEntry | undefined {
  return endpointCatalog.find((entry) => entry.operation === operation);
}
