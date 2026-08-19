import { http, type JsonRecord } from "#relay/internal/http.js";

// The deployment's internal status reader. It wraps the internal `http`
// helper in a small `api` record whose name is deliberately reused from the
// review module's injected provider parameter and the drafting module's
// unwrapped client binding. Nothing in this file constructs or calls a
// provider client, so the reviewed expectation is that no provider
// observation is attributed here despite the reused names. This workspace
// compiles only and is never invoked.

export interface DeploymentStatus {
  phase: string;
  lastRelay: string;
}

// internal-status-reader
export async function readDeploymentStatus(base: string): Promise<DeploymentStatus> {
  const api = {
    readStatus: (): Promise<JsonRecord> => http.getJson(base, "/status")
  };
  const status = await api.readStatus();
  return {
    phase: typeof status.phase === "string" ? status.phase : "unknown",
    lastRelay: typeof status.lastRelay === "string" ? status.lastRelay : "never"
  };
}
