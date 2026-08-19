// A narrow internal HTTP wrapper shared by the deployment's tooling
// modules. It only fetches deployment-internal status endpoints; it never
// constructs or wraps a provider client, and its `http` name is deliberately
// one of the generic names reused across the composed deployment so
// name-based attribution has something to miss. This workspace compiles
// only and is never invoked.

export interface JsonRecord {
  [key: string]: unknown;
}

// internal-status-http-wrapper
export const http = {
  async getJson(base: string, path: string): Promise<JsonRecord> {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`Status request failed: ${response.status}`);
    }
    return (await response.json()) as JsonRecord;
  }
};
