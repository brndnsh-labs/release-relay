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
const COMPARISON_COMMIT_LIMIT = 250;
const GITHUB_API_BASE_URL = "https://api.github.com";
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;
const COMPARISON_STATUSES = new Set(["ahead", "behind", "diverged", "identical"]);

// ponytail: closing keywords + "Reverts owner/repo#N" body scans cover the
// documented derivation rules; a commit-to-PR GraphQL join is the upgrade path
// if body-less merge styles become a product concern.
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

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
  sort: "updated";
  direction: "desc";
}

interface IssuePageParams extends PageParams {
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
  listIssues(params: IssuePageParams): Promise<ApiResponse>;
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
  return typeof record[key] === "number" && Number.isSafeInteger(record[key])
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
  if (status === 409 || status === 422) {
    return { status: "refused", operationId: "", errorClass: "conflict" };
  }
  if (status === 401 || status === 403) {
    return { status: "refused", operationId: "", errorClass: "authorization" };
  }
  if (status === 404) {
    return { status: "refused", operationId: "", errorClass: "not-found" };
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
    repository.owner.toLowerCase() === scope.repository.owner.toLowerCase() &&
    repository.name.toLowerCase() === scope.repository.name.toLowerCase()
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

function githubRepositoryFromUrl(
  value: string,
  expectedSuffix: readonly string[] = []
): RepositoryRef | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return undefined;
  }
  const segments = url.pathname.split("/");
  if (
    segments[0] !== "" ||
    segments[1] === undefined ||
    segments[1] === "" ||
    segments[2] === undefined ||
    segments[2] === "" ||
    !expectedSuffix.every((segment, index) => segments[index + 3] === segment)
  ) {
    return undefined;
  }
  if (
    (expectedSuffix.length === 0 && segments.length !== 3) ||
    (expectedSuffix.length > 0 &&
      (segments.length <= 3 + expectedSuffix.length ||
        segments.slice(3 + expectedSuffix.length).some((segment) => segment === "")))
  ) {
    return undefined;
  }
  return { owner: segments[1], name: segments[2] };
}

function sameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}

function mapRepository(
  data: Record<string, unknown>,
  scope: RepositoryRef
): RepositorySummary {
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
  const responseRepository = { owner, name };
  const urlRepository = githubRepositoryFromUrl(url);
  if (
    !sameRepository(responseRepository, scope) ||
    urlRepository === undefined ||
    !sameRepository(urlRepository, scope)
  ) {
    throw new AdapterError("invalid-input");
  }
  return {
    owner: scope.owner,
    name: scope.name,
    id: String(id),
    url: `https://github.com/${scope.owner}/${scope.name}`
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The comparison response itself carries the repository identity
// (https://github.com/{owner}/{repo}/compare/...). A response naming a
// different repository than the configured scope — or one whose identity
// cannot be established at all — is rejected, not mapped.
function checkComparisonIdentity(
  comparison: Record<string, unknown>,
  scope: RepositoryRef
): void {
  const url = stringValue(comparison, "html_url");
  const repository =
    url === undefined ? undefined : githubRepositoryFromUrl(url, ["compare"]);
  if (repository === undefined || !sameRepository(repository, scope)) {
    throw new AdapterError("invalid-input");
  }
}

interface ParsedComparison {
  rangeShas: ReadonlySet<string>;
  rangeContributors: ReadonlyMap<string, ContributorSummary>;
  totalCommits: number;
}

function parseComparison(
  comparison: Record<string, unknown>,
  scope: RepositoryRef
): ParsedComparison {
  checkComparisonIdentity(comparison, scope);
  const status = stringValue(comparison, "status");
  const totalCommits = numberValue(comparison, "total_commits");
  if (
    status === undefined ||
    !COMPARISON_STATUSES.has(status) ||
    totalCommits === undefined ||
    totalCommits < 0
  ) {
    throw new AdapterError("invalid-input");
  }

  const commits = comparison.commits;
  if (commits !== undefined && !Array.isArray(commits)) {
    throw new AdapterError("invalid-input");
  }
  const commitItems = commits ?? [];
  if (
    (totalCommits > 0 && commitItems.length === 0) ||
    (totalCommits <= COMPARISON_COMMIT_LIMIT && commitItems.length !== totalCommits) ||
    (totalCommits > COMPARISON_COMMIT_LIMIT &&
      commitItems.length !== COMPARISON_COMMIT_LIMIT) ||
    ((status === "identical" || status === "behind") && totalCommits !== 0) ||
    ((status === "ahead" || status === "diverged") && totalCommits === 0)
  ) {
    throw new AdapterError("invalid-input");
  }

  const rangeShas = new Set<string>();
  const rangeContributors = new Map<string, ContributorSummary>();
  for (const item of commitItems) {
    if (!isRecord(item)) throw new AdapterError("invalid-input");
    const sha = stringValue(item, "sha");
    if (sha === undefined || !FULL_COMMIT_SHA.test(sha)) {
      throw new AdapterError("invalid-input");
    }
    const normalizedSha = sha.toLowerCase();
    if (rangeShas.has(normalizedSha)) throw new AdapterError("invalid-input");
    rangeShas.add(normalizedSha);
    if (isRecord(item.author)) {
      const identity = stringValue(item.author, "login");
      const url = stringValue(item.author, "html_url");
      if (identity !== undefined && url !== undefined) {
        rangeContributors.set(identity, { identity, url });
      }
    }
  }

  return { rangeShas, rangeContributors, totalCommits };
}

interface LivePullRequest {
  number: number;
  summary: PullRequestSummary;
  mergeCommitSha: string | undefined;
  body: string | undefined;
}

function mapPullRequest(data: unknown): LivePullRequest | undefined {
  if (!isRecord(data)) return undefined;
  const number = numberValue(data, "number");
  const url = stringValue(data, "html_url");
  const title = stringValue(data, "title");
  if (number === undefined || url === undefined || title === undefined)
    return undefined;
  return {
    number,
    mergeCommitSha: stringValue(data, "merge_commit_sha"),
    body: stringValue(data, "body"),
    summary: {
      sourceIdentity: `pull/${number}`,
      url,
      title,
      merged: typeof data.merged_at === "string",
      reverted: false,
      linkedIssueIdentities: []
    }
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
          ),
          scope.repository
        )
      );
    },
    compare: async ({ operationId, repository, range }) => {
      if (!checkScope(scope, repository)) {
        return { status: "refused", operationId, errorClass: "invalid-input" };
      }
      return run(operationId, async () => {
        // The comparison payload is the authoritative range boundary: every
        // candidate below must be evidenced by a commit SHA it reports.
        const comparison = responseRecord(
          await api.compareCommits({
            owner: scope.repository.owner,
            repo: scope.repository.name,
            base: range.base,
            head: range.head
          })
        );
        const { rangeShas, rangeContributors, totalCommits } = parseComparison(
          comparison,
          scope.repository
        );
        const base = { owner: scope.repository.owner, repo: scope.repository.name };

        // ponytail: the unpaginated compare response caps commits[] at 250;
        // ranges beyond that under-report SHAs and conservatively exclude the
        // tail PRs. Paginate compareCommits if such ranges become real.
        // Prior releases stay separated as context; they can never become
        // candidates regardless of range contents.
        const priorReleases = (
          await pageThrough(api.listReleases, base, pages)
        ).flatMap((item) => {
          const mapped = mapRelease(item);
          return mapped === undefined ? [] : [mapped];
        });

        // An identical or commit-less range selects nothing, even when
        // repository-wide endpoints contain old closed work. A response that
        // claims commits but carries no valid, count-consistent commit list is
        // malformed, not empty — reject it loudly instead of silently dropping
        // every candidate.
        if (totalCommits === 0) {
          return {
            range,
            pullRequests: [],
            issues: [],
            contributors: [],
            priorReleases
          } satisfies ComparisonResult;
        }

        const [pullRequests, issues] = await Promise.all([
          pageThrough(
            api.listPullRequests,
            { ...base, state: "closed", sort: "updated", direction: "desc" },
            pages
          ),
          pageThrough(api.listIssues, { ...base, state: "closed" }, pages)
        ]);

        // Retention rule: a closed pull request is a candidate only when it
        // is merged and its merge commit is one of the range's commits.
        const retained: LivePullRequest[] = [];
        for (const item of pullRequests) {
          const mapped = mapPullRequest(item);
          if (mapped === undefined || !mapped.summary.merged) continue;
          if (
            mapped.mergeCommitSha !== undefined &&
            rangeShas.has(mapped.mergeCommitSha.toLowerCase())
          ) {
            retained.push(mapped);
          }
        }

        // Reverted-work rule: a retained PR whose body carries GitHub's
        // "Reverts owner/repo#N" line marks that referenced PR reverted.
        // ponytail: conservative fallback — a revert whose PR body doesn't
        // match the pattern (or falls outside the pulls.list recency window)
        // leaves reverted false; per-commit /commits/{sha}/pulls fan-out is
        // the upgrade path if silent reverts become a real problem.
        const revertPattern = new RegExp(
          `\\bReverts?\\s+${escapeRegExp(
            `${scope.repository.owner}/${scope.repository.name}`
          )}#(\\d+)\\b`,
          "i"
        );
        const revertedNumbers = new Set<number>();
        for (const pr of retained) {
          const match = pr.body?.match(revertPattern);
          if (match !== null && match !== undefined)
            revertedNumbers.add(Number(match[1]));
        }

        // Linked-issue rule: closing keywords in a retained PR's body link it
        // to the referenced issue, which lets the assembler dedupe one change
        // across its PR and issue identities.
        const linkedIssues = new Map<number, string[]>();
        for (const pr of retained) {
          if (pr.body === undefined) continue;
          for (const match of pr.body.matchAll(CLOSING_KEYWORD)) {
            const issueNumber = Number(match[1]);
            const links = linkedIssues.get(issueNumber) ?? [];
            if (!links.includes(pr.summary.sourceIdentity))
              links.push(pr.summary.sourceIdentity);
            linkedIssues.set(issueNumber, links);
          }
        }

        const retainedSummaries = retained.map((pr) => ({
          ...pr.summary,
          reverted: revertedNumbers.has(pr.number),
          linkedIssueIdentities: [...linkedIssues.entries()]
            .filter(([, prIdentities]) =>
              prIdentities.includes(pr.summary.sourceIdentity)
            )
            .map(([issueNumber]) => `issue/${issueNumber}`)
        }));

        const linkedIssueSummaries = issues
          .flatMap((item) => {
            const mapped = mapIssue(item);
            return mapped === undefined ? [] : [mapped];
          })
          .filter((issue) => {
            const sourceNumber = Number(issue.sourceIdentity.slice("issue/".length));
            return linkedIssues.has(sourceNumber);
          })
          .map((issue) => ({
            ...issue,
            linkedPullRequestIdentities:
              linkedIssues.get(Number(issue.sourceIdentity.slice("issue/".length))) ??
              []
          }));

        return {
          range,
          pullRequests: retainedSummaries,
          issues: linkedIssueSummaries,
          contributors: [...rangeContributors.values()],
          priorReleases
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
