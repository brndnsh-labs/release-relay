// An internal API gateway client that reads release-relay traffic through a
// private host. The paths deliberately resemble provider API paths, but the
// host is not a provider endpoint and no provider SDK, credential, or client
// is involved, so no provider observation may be attributed to this file.
// This workspace compiles only and is never invoked.

const gatewayBase = "https://relay-gateway.internal";

// foreign-host-gateway-request
export async function readGateway(path: string): Promise<unknown> {
  const response = await fetch(`${gatewayBase}${path}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Gateway request failed: ${response.status}`);
  }
  return response.json();
}

export function reviewProxyPath(draftId: string): string {
  return `/v1/messages/${draftId}`;
}

export function draftProxyPath(draftId: string): string {
  return `/v1/responses/${draftId}`;
}
