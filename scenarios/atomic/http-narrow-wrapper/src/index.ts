// A maintainer CLI helper that previews an upcoming release by reading a
// comparison range through a narrow wrapper around fetch that applies
// GitHub REST conventions, rather than through the official SDK or Release
// Relay's injected adapter. The wrapper is local to this compile-only
// workspace and issues nothing on its own; the resource path is assembled
// from explicit parameters and the token is an explicit parameter, never
// read from the environment. This workspace is never invoked, so the
// request can never execute.

export interface WrapperComparisonSummary {
  commitCount: number;
  commitMessages: string[];
}

async function getJson(url: string, token: string, accept: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept }
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

// wrapper-compare-request
export async function readComparisonViaWrapper(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<WrapperComparisonSummary> {
  const payload = (await getJson(
    `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
    token,
    "application/vnd.github+json"
  )) as { commits?: Array<{ commit?: { message?: string } }> };
  const commits = payload.commits ?? [];
  return {
    commitCount: commits.length,
    commitMessages: commits.map((commit) => commit.commit?.message ?? "")
  };
}
