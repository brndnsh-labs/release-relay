import { Octokit, type Octokit as OctokitClient } from "@octokit/rest";
import type {
  ComparisonResult,
  ContributorSummary,
  GitHubReader,
  IssueSummary,
  OperationId,
  OperationResult,
  PullRequestSummary,
  ReleaseSummary,
  RepositoryRef,
  RepositorySummary,
  SafeErrorClass
} from "@release-relay/core";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const GITHUB_API_BASE_URL = "https://api.github.com";

interface ApiResponse {
  data: unknown;
}

interface PageParams {
  owner: string;
  repo: string;
  page: number;
  per_page: number;
}

interface PullRequestPageParams extends PageParams {
  state: "closed";
}

export interface GitHubApi {
  getRepository(params: { owner: string; repo: string }): Promise<ApiResponse>;
  compareCommits(params: {
    owner: string;
    repo: string;
    base: string;
    head: string;
  }): Promise<ApiResponse>;
  listPullRequests(params: PullRequestPageParams): Promise<ApiResponse>;
  listIssues(params: PullRequestPageParams): Promise<ApiResponse>;
  listContributors(params: PageParams): Promise<ApiResponse>;
  listReleases(params: PageParams): Promise<ApiResponse>;
}

export interface GitHubReadScope {
  repository: RepositoryRef;
  maxPages?: number;
}

export interface LiveGitHubReaderOptions extends GitHubReadScope {
  authToken: string;
  userAgent?: string;
}

class AdapterError extends Error {
  constructor(readonly errorClass: SafeErrorClass) {
    super("GitHub adapter response was invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" && record[key] !== ""
    ? record[key]
    : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === "number" && Number.isInteger(record[key])
    ? record[key]
    : undefined;
}

function responseItems(response: ApiResponse): readonly unknown[] {
  if (!Array.isArray(response.data)) throw new AdapterError("invalid-input");
  return response.data;
}

function responseRecord(response: ApiResponse): Record<string, unknown> {
  if (!isRecord(response.data)) throw new AdapterError("invalid-input");
  return response.data;
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.status === "number") return error.status;
  return isRecord(error.response) && typeof error.response.status === "number"
    ? error.response.status
    : undefined;
}

function failureFor(
  error: unknown
): Extract<OperationResult<never>, { status: "refused" | "failed" }> {
  if (error instanceof AdapterError) {
    return { status: "failed", operationId: "", errorClass: error.errorClass };
  }
  const status = statusOf(error);
  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 422
  ) {
    return {
      status: "refused",
      operationId: "",
      errorClass: status === 404 ? "not-found" : "authorization"
    };
  }
  if (status === 429)
    return { status: "failed", operationId: "", errorClass: "rate-limit" };
  if (status !== undefined && status >= 500) {
    return { status: "failed", operationId: "", errorClass: "unavailable" };
  }
  return { status: "failed", operationId: "", errorClass: "unknown" };
}

async function run<T>(
  operationId: OperationId,
  action: () => Promise<T>
): Promise<OperationResult<T>> {
  try {
    return { status: "completed", operationId, value: await action() };
  } catch (error) {
    const failure = failureFor(error);
    return { ...failure, operationId };
  }
}

function checkScope(scope: GitHubReadScope, repository: RepositoryRef): boolean {
  return (
    repository.owner === scope.repository.owner &&
    repository.name === scope.repository.name
  );
}

function maxPages(scope: GitHubReadScope): number {
  if (scope.maxPages === undefined) return DEFAULT_MAX_PAGES;
  if (!Number.isInteger(scope.maxPages) || scope.maxPages < 1 || scope.maxPages > 100) {
    throw new Error("maxPages must be an integer between 1 and 100");
  }
  return scope.maxPages;
}

async function pageThrough<TParams extends PageParams>(
  request: (params: TParams) => Promise<ApiResponse>,
  base: Omit<TParams, "page" | "per_page">,
  limit: number
): Promise<readonly unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= limit; page += 1) {
    const pageItems = responseItems(
      await request({ ...base, page, per_page: PAGE_SIZE } as TParams)
    );
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) break;
  }
  return items;
}

function mapRepository(data: Record<string, unknown>): RepositorySummary {
  const owner = isRecord(data.owner) ? stringValue(data.owner, "login") : undefined;
  const id = numberValue(data, "id");
  const name = stringValue(data, "name");
  const url = stringValue(data, "html_url");
  if (
    owner === undefined ||
    id === undefined ||
    name === undefined ||
    url === undefined
  ) {
    throw new AdapterError("invalid-input");
  }
  return { owner, name, id: String(id), url };
}

function mapPullRequest(data: unknown): PullRequestSummary | undefined {
  if (!isRecord(data)) return undefined;
  const number = numberValue(data, "number");
  const url = stringValue(data, "html_url");
  const title = stringValue(data, "title");
  if (number === undefined || url === undefined || title === undefined)
    return undefined;
  return {
    sourceIdentity: `pull/${number}`,
    url,
    title,
    merged: typeof data.merged_at === "string",
    reverted: false,
    linkedIssueIdentities: []
  };
}

function mapIssue(data: unknown): IssueSummary | undefined {
  if (!isRecord(data)) return undefined;
  if (isRecord(data.pull_request)) return undefined;
  const number = numberValue(data, "number");
  const url = stringValue(data, "html_url");
  const title = stringValue(data, "title");
  if (number === undefined || url === undefined || title === undefined)
    return undefined;
  return {
    sourceIdentity: `issue/${number}`,
    url,
    title,
    closed: data.state === "closed",
    linkedPullRequestIdentities: []
  };
}

function mapContributor(data: unknown): ContributorSummary | undefined {
  if (!isRecord(data)) return undefined;
  const identity = stringValue(data, "login");
  const url = stringValue(data, "html_url");
  return identity === undefined || url === undefined ? undefined : { identity, url };
}

function mapRelease(data: unknown): ReleaseSummary | undefined {
  if (!isRecord(data)) return undefined;
  const tag = stringValue(data, "tag_name");
  const url = stringValue(data, "html_url");
  if (tag === undefined || url === undefined) return undefined;
  return { tag, url, title: stringValue(data, "name") ?? tag };
}

function apiFromOctokit(client: OctokitClient): GitHubApi {
  // read-adapter-client
  return {
    getRepository: (params) => client.rest.repos.get(params),
    compareCommits: (params) => client.rest.repos.compareCommits(params),
    listPullRequests: (params) =>
      client.rest.pulls.list(params as Parameters<typeof client.rest.pulls.list>[0]),
    listIssues: (params) =>
      client.rest.issues.listForRepo(
        params as Parameters<typeof client.rest.issues.listForRepo>[0]
      ),
    listContributors: (params) =>
      client.rest.repos.listContributors(
        params as Parameters<typeof client.rest.repos.listContributors>[0]
      ),
    listReleases: (params) =>
      client.rest.repos.listReleases(
        params as Parameters<typeof client.rest.repos.listReleases>[0]
      )
  };
}

export function createGitHubReader(
  api: GitHubApi,
  scope: GitHubReadScope
): GitHubReader {
  const pages = maxPages(scope);
  return {
    getRepository: async ({ operationId, repository }) => {
      if (!checkScope(scope, repository)) {
        return { status: "refused", operationId, errorClass: "invalid-input" };
      }
      return run(operationId, async () =>
        mapRepository(
          responseRecord(
            await api.getRepository({
              owner: scope.repository.owner,
              repo: scope.repository.name
            })
          )
        )
      );
    },
    compare: async ({ operationId, repository, range }) => {
      if (!checkScope(scope, repository)) {
        return { status: "refused", operationId, errorClass: "invalid-input" };
      }
      return run(operationId, async () => {
        await api
          .compareCommits({
            owner: scope.repository.owner,
            repo: scope.repository.name,
            base: range.base,
            head: range.head
          })
          .then(responseRecord);
        const base = { owner: scope.repository.owner, repo: scope.repository.name };
        const [pullRequests, issues, contributors, priorReleases] = await Promise.all([
          pageThrough(api.listPullRequests, { ...base, state: "closed" }, pages),
          pageThrough(api.listIssues, { ...base, state: "closed" }, pages),
          pageThrough(api.listContributors, base, pages),
          pageThrough(api.listReleases, base, pages)
        ]);
        return {
          range,
          pullRequests: pullRequests.flatMap((item) => {
            const mapped = mapPullRequest(item);
            return mapped === undefined ? [] : [mapped];
          }),
          issues: issues.flatMap((item) => {
            const mapped = mapIssue(item);
            return mapped === undefined ? [] : [mapped];
          }),
          contributors: contributors.flatMap((item) => {
            const mapped = mapContributor(item);
            return mapped === undefined ? [] : [mapped];
          }),
          priorReleases: priorReleases.flatMap((item) => {
            const mapped = mapRelease(item);
            return mapped === undefined ? [] : [mapped];
          })
        } satisfies ComparisonResult;
      });
    }
  };
}

export function createGitHubReaderFromOctokit(
  client: OctokitClient,
  scope: GitHubReadScope
): GitHubReader {
  return createGitHubReader(apiFromOctokit(client), scope);
}

export function createLiveGitHubReader(options: LiveGitHubReaderOptions): GitHubReader {
  if (options.authToken.trim() === "") throw new Error("authToken is required");
  const client = new Octokit({
    auth: options.authToken,
    baseUrl: GITHUB_API_BASE_URL,
    userAgent: options.userAgent ?? "release-relay/github-integration"
  });
  return createGitHubReaderFromOctokit(client, options);
}
