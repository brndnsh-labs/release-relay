import { createHash, randomUUID } from "node:crypto";
import { Octokit, type Octokit as OctokitClient } from "@octokit/rest";
import type {
  ConfirmedReleasePublication,
  GitHubPublisher,
  OperationId,
  OperationResult,
  PublishedRelease,
  ReleaseAuthorization,
  ReleaseConfirmation,
  ReleaseConfirmationInput,
  ReleasePreview,
  ReleasePublicationRequest,
  RepositoryRef,
  SafeErrorClass
} from "@release-relay/core";
import { releasePreviewHash } from "@release-relay/core";

const GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

interface ApiResponse {
  data: unknown;
}

interface RepositoryParams {
  owner: string;
  repo: string;
}

interface ReleaseTagParams extends RepositoryParams {
  tag: string;
}

interface CreateReleaseParams extends RepositoryParams {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
}

export interface GitHubWriteApi {
  getRepository(params: RepositoryParams): Promise<ApiResponse>;
  getReleaseByTag(params: ReleaseTagParams): Promise<ApiResponse>;
  createRelease(params: CreateReleaseParams): Promise<ApiResponse>;
}

export interface GitHubWriteScope {
  repository: RepositoryRef;
  confirmationTtlMs?: number;
  now?: () => Date;
  createToken?: () => string;
}

export interface LiveGitHubPublisherOptions extends GitHubWriteScope {
  authToken: string;
  userAgent?: string;
}

type FailureStatus = "refused" | "failed";

class AdapterError extends Error {
  constructor(
    readonly status: FailureStatus,
    readonly errorClass: SafeErrorClass
  ) {
    super("GitHub publication adapter rejected the operation");
  }
}

interface Failure {
  status: FailureStatus;
  errorClass: SafeErrorClass;
}

interface RemoteRelease {
  value: PublishedRelease;
  tag: string;
  title: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
}

interface StoredOperation {
  previewHash: string;
  value: PublishedRelease;
}

interface InFlightOperation {
  previewHash: string;
  promise: Promise<OperationResult<PublishedRelease>>;
}

type Reconciliation =
  | { kind: "absent" }
  | { kind: "matching"; release: RemoteRelease }
  | { kind: "conflict" }
  | ({ kind: "error" } & Failure);

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

function booleanValue(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] : undefined;
}

function statusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.status === "number") return error.status;
  return isRecord(error.response) && typeof error.response.status === "number"
    ? error.response.status
    : undefined;
}

function classify(error: unknown): Failure {
  if (error instanceof AdapterError) {
    return { status: error.status, errorClass: error.errorClass };
  }
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return { status: "refused", errorClass: "authorization" };
  }
  if (status === 404) return { status: "refused", errorClass: "not-found" };
  if (status === 409 || status === 422) {
    return { status: "refused", errorClass: "conflict" };
  }
  if (status === 429) return { status: "failed", errorClass: "rate-limit" };
  if (status !== undefined && status >= 500) {
    return { status: "failed", errorClass: "unavailable" };
  }
  return { status: "failed", errorClass: "unknown" };
}

async function run<T>(
  operationId: OperationId,
  action: () => Promise<T>
): Promise<OperationResult<T>> {
  try {
    return { status: "completed", operationId, value: await action() };
  } catch (error) {
    return { ...classify(error), operationId };
  }
}

async function runResult<T>(
  operationId: OperationId,
  action: () => Promise<OperationResult<T>>
): Promise<OperationResult<T>> {
  try {
    return await action();
  } catch (error) {
    return { ...classify(error), operationId };
  }
}

function sameRepository(left: RepositoryRef, right: RepositoryRef): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}

function cloneRepository(repository: RepositoryRef): RepositoryRef {
  return { owner: repository.owner, name: repository.name };
}

function clonePreview(preview: ReleasePreview): ReleasePreview {
  return {
    ...previewFields(preview),
    repository: cloneRepository(preview.repository),
    previewHash: preview.previewHash
  };
}

function cloneConfirmation(confirmation: ReleaseConfirmation): ReleaseConfirmation {
  return { ...confirmation };
}

function samePreview(left: ReleasePreview, right: ReleasePreview): boolean {
  return (
    left.previewHash === right.previewHash &&
    JSON.stringify(previewFields(left)) === JSON.stringify(previewFields(right))
  );
}

function requiredText(value: unknown): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdapterError("failed", "invalid-input");
  }
}

function operationIdOf(value: unknown): string {
  return isRecord(value) && typeof value.operationId === "string"
    ? value.operationId
    : "";
}

function currentDate(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("clock returned an invalid date");
  }
  return value;
}

function isExpired(preview: ReleasePreview, now: () => Date): boolean {
  return currentDate(now).getTime() >= Date.parse(preview.expiresAt);
}

function previewFields(preview: ReleasePreview): Omit<ReleasePreview, "previewHash"> {
  return {
    operationId: preview.operationId,
    workspaceId: preview.workspaceId,
    repository: preview.repository,
    authorizationRevision: preview.authorizationRevision,
    tag: preview.tag,
    title: preview.title,
    body: preview.body,
    draft: preview.draft,
    prerelease: preview.prerelease,
    expiresAt: preview.expiresAt
  };
}

function validatePreview(preview: ReleasePreview, repository: RepositoryRef): void {
  if (!sameRepository(preview.repository, repository)) {
    throw new AdapterError("failed", "invalid-input");
  }
  requiredText(preview.operationId);
  requiredText(preview.workspaceId);
  requiredText(preview.authorizationRevision);
  requiredText(preview.tag);
  requiredText(preview.title);
  if (typeof preview.body !== "string") {
    throw new AdapterError("failed", "invalid-input");
  }
  if (typeof preview.draft !== "boolean" || typeof preview.prerelease !== "boolean") {
    throw new AdapterError("failed", "invalid-input");
  }
  if (Number.isNaN(Date.parse(preview.expiresAt))) {
    throw new AdapterError("failed", "invalid-input");
  }
  if (releasePreviewHash(previewFields(preview)) !== preview.previewHash) {
    throw new AdapterError("failed", "invalid-input");
  }
}

function mapAuthorization(
  data: unknown,
  repository: RepositoryRef
): ReleaseAuthorization {
  if (!isRecord(data)) throw new AdapterError("failed", "invalid-input");
  const id = numberValue(data, "id");
  const fullName = stringValue(data, "full_name");
  const permissions = data.permissions;
  if (id === undefined || fullName === undefined || !isRecord(permissions)) {
    throw new AdapterError("failed", "invalid-input");
  }
  const admin = booleanValue(permissions, "admin");
  const push = booleanValue(permissions, "push");
  const maintain = booleanValue(permissions, "maintain");
  if (admin === undefined || push === undefined || maintain === undefined) {
    throw new AdapterError("failed", "invalid-input");
  }
  const revision = createHash("sha256")
    .update(JSON.stringify({ id, fullName, admin, push, maintain }))
    .digest("hex");
  return {
    repository,
    revision,
    canPublish: admin || push || maintain
  };
}

function mapRelease(data: unknown): RemoteRelease {
  if (!isRecord(data)) throw new AdapterError("failed", "invalid-input");
  const tag = stringValue(data, "tag_name");
  const url = stringValue(data, "html_url");
  const title = stringValue(data, "name");
  const body = typeof data.body === "string" ? data.body : undefined;
  const draft = booleanValue(data, "draft");
  const prerelease = booleanValue(data, "prerelease");
  if (
    tag === undefined ||
    url === undefined ||
    title === undefined ||
    body === undefined ||
    draft === undefined ||
    prerelease === undefined
  ) {
    throw new AdapterError("failed", "invalid-input");
  }
  return {
    value: { url, tag },
    tag,
    title,
    body,
    draft,
    prerelease
  };
}

function matchesPreview(release: RemoteRelease, preview: ReleasePreview): boolean {
  return (
    release.tag === preview.tag &&
    release.title === preview.title &&
    release.body === preview.body &&
    release.draft === preview.draft &&
    release.prerelease === preview.prerelease
  );
}

function matchingConfirmation(
  confirmation: ReleaseConfirmation,
  request: ConfirmedReleasePublication
): boolean {
  return (
    confirmation.previewHash === request.previewHash &&
    confirmation.authorizationRevision === request.authorizationRevision &&
    confirmation.expiresAt === request.expiresAt
  );
}

export function createGitHubPublisher(
  api: GitHubWriteApi,
  scope: GitHubWriteScope
): GitHubPublisher {
  const configuredRepository = cloneRepository(scope.repository);
  const ttl = scope.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
  if (!Number.isInteger(ttl) || ttl < 1_000 || ttl > MAX_CONFIRMATION_TTL_MS) {
    throw new Error("confirmationTtlMs must be an integer between 1000 and 900000");
  }
  const now = scope.now ?? (() => new Date());
  const createToken = scope.createToken ?? randomUUID;
  const previews = new Map<string, ReleasePreview>();
  const operationPreviews = new Map<OperationId, string>();
  const confirmations = new Map<string, ReleaseConfirmation>();
  const operations = new Map<OperationId, StoredOperation>();
  const inFlight = new Map<OperationId, InFlightOperation>();
  const params = {
    owner: configuredRepository.owner,
    repo: configuredRepository.name
  };

  async function currentAuthorization(): Promise<ReleaseAuthorization> {
    return mapAuthorization(
      (await api.getRepository(params)).data,
      configuredRepository
    );
  }

  function validateIssuedPreview(preview: ReleasePreview): void {
    validatePreview(preview, configuredRepository);
    const issued = previews.get(preview.previewHash);
    if (
      issued === undefined ||
      operationPreviews.get(preview.operationId) !== preview.previewHash ||
      !samePreview(issued, preview)
    ) {
      throw new AdapterError("failed", "invalid-input");
    }
  }

  function validateConfirmedPublication(
    publication: ConfirmedReleasePublication
  ): void {
    validateIssuedPreview(publication);
    const confirmation = confirmations.get(publication.confirmation.token);
    if (
      confirmation === undefined ||
      !matchingConfirmation(confirmation, publication)
    ) {
      throw new AdapterError("failed", "invalid-input");
    }
  }

  async function reconcile(preview: ReleasePreview): Promise<Reconciliation> {
    try {
      const release = mapRelease(
        (await api.getReleaseByTag({ ...params, tag: preview.tag })).data
      );
      return matchesPreview(release, preview)
        ? { kind: "matching", release }
        : { kind: "conflict" };
    } catch (error) {
      if (statusOf(error) === 404) return { kind: "absent" };
      return { kind: "error", ...classify(error) };
    }
  }

  function ensureAuthorized(
    authorization: ReleaseAuthorization,
    preview: ReleasePreview
  ): void {
    if (
      !authorization.canPublish ||
      authorization.revision !== preview.authorizationRevision
    ) {
      throw new AdapterError("refused", "authorization");
    }
  }

  return {
    getAuthorization: async ({ operationId, repository }) => {
      if (!sameRepository(repository, configuredRepository)) {
        return { status: "refused", operationId, errorClass: "invalid-input" };
      }
      return run(operationId, currentAuthorization);
    },

    previewRelease: (request: ReleasePublicationRequest): ReleasePreview => {
      if (!sameRepository(request.repository, configuredRepository)) {
        throw new AdapterError("failed", "invalid-input");
      }
      requiredText(request.operationId);
      requiredText(request.workspaceId);
      requiredText(request.authorizationRevision);
      requiredText(request.tag);
      requiredText(request.title);
      if (typeof request.body !== "string") {
        throw new AdapterError("failed", "invalid-input");
      }
      if (
        (request.draft !== undefined && typeof request.draft !== "boolean") ||
        (request.prerelease !== undefined && typeof request.prerelease !== "boolean")
      ) {
        throw new AdapterError("failed", "invalid-input");
      }
      const expiresAt = new Date(currentDate(now).getTime() + ttl).toISOString();
      const fields = {
        operationId: request.operationId,
        workspaceId: request.workspaceId,
        repository: cloneRepository(request.repository),
        authorizationRevision: request.authorizationRevision,
        tag: request.tag,
        title: request.title,
        body: request.body,
        draft: request.draft ?? false,
        prerelease: request.prerelease ?? false,
        expiresAt
      };
      const preview = { ...fields, previewHash: releasePreviewHash(fields) };
      const previousHash = operationPreviews.get(preview.operationId);
      if (previousHash !== undefined && previousHash !== preview.previewHash) {
        throw new AdapterError("refused", "conflict");
      }
      operationPreviews.set(preview.operationId, preview.previewHash);
      previews.set(preview.previewHash, clonePreview(preview));
      return clonePreview(preview);
    },

    confirmRelease: (input: ReleaseConfirmationInput) => {
      const operationId = operationIdOf(isRecord(input) ? input.preview : undefined);
      try {
        const preview = clonePreview(input.preview);
        const { authorizationRevision } = input;
        validateIssuedPreview(preview);
        if (isExpired(preview, now)) {
          throw new AdapterError("failed", "invalid-input");
        }
        if (authorizationRevision !== preview.authorizationRevision) {
          throw new AdapterError("refused", "authorization");
        }
        const token = createToken();
        requiredText(token);
        const confirmation = {
          token,
          previewHash: preview.previewHash,
          authorizationRevision: preview.authorizationRevision,
          expiresAt: preview.expiresAt
        };
        confirmations.set(token, cloneConfirmation(confirmation));
        return {
          status: "completed",
          operationId: preview.operationId,
          value: cloneConfirmation(confirmation)
        };
      } catch (error) {
        return { ...classify(error), operationId };
      }
    },

    publishRelease: (request: ConfirmedReleasePublication) => {
      const operationId = operationIdOf(request);
      let publication: ConfirmedReleasePublication;
      try {
        publication = {
          ...clonePreview(request),
          confirmation: cloneConfirmation(request.confirmation)
        };
        validateConfirmedPublication(publication);
      } catch (error) {
        return Promise.resolve({ ...classify(error), operationId });
      }
      const flight = inFlight.get(publication.operationId);
      if (flight !== undefined) {
        return flight.previewHash === publication.previewHash
          ? flight.promise
          : Promise.resolve({
              status: "refused",
              operationId: publication.operationId,
              errorClass: "conflict"
            });
      }

      const promise = runResult(publication.operationId, async () => {
        validateConfirmedPublication(publication);

        await currentAuthorization();

        const previous = operations.get(publication.operationId);
        if (previous !== undefined) {
          if (previous.previewHash !== publication.previewHash) {
            throw new AdapterError("refused", "conflict");
          }
          return {
            status: "duplicate",
            operationId: publication.operationId,
            value: previous.value
          };
        }

        const existing = await reconcile(publication);
        if (existing.kind === "matching") {
          operations.set(publication.operationId, {
            previewHash: publication.previewHash,
            value: existing.release.value
          });
          return {
            status: "duplicate",
            operationId: publication.operationId,
            value: existing.release.value
          };
        }
        if (existing.kind === "conflict") {
          throw new AdapterError("refused", "conflict");
        }
        if (existing.kind === "error") {
          throw new AdapterError(existing.status, existing.errorClass);
        }
        if (isExpired(publication, now)) {
          throw new AdapterError("failed", "invalid-input");
        }

        ensureAuthorized(await currentAuthorization(), publication);
        if (isExpired(publication, now)) {
          throw new AdapterError("failed", "invalid-input");
        }
        try {
          const release = mapRelease(
            (
              await api.createRelease({
                ...params,
                tag_name: publication.tag,
                name: publication.title,
                body: publication.body,
                draft: publication.draft,
                prerelease: publication.prerelease
              })
            ).data
          );
          if (!matchesPreview(release, publication)) {
            throw new AdapterError("failed", "invalid-input");
          }
          operations.set(publication.operationId, {
            previewHash: publication.previewHash,
            value: release.value
          });
          return {
            status: "completed",
            operationId: publication.operationId,
            value: release.value
          };
        } catch (error) {
          const recovered = await reconcile(publication);
          if (recovered.kind === "matching") {
            operations.set(publication.operationId, {
              previewHash: publication.previewHash,
              value: recovered.release.value
            });
            return {
              status: "completed",
              operationId: publication.operationId,
              value: recovered.release.value
            };
          }
          if (recovered.kind === "conflict") {
            throw new AdapterError("refused", "conflict");
          }
          throw error;
        }
      });
      inFlight.set(publication.operationId, {
        previewHash: publication.previewHash,
        promise
      });
      void promise.finally(() => {
        if (inFlight.get(publication.operationId)?.promise === promise) {
          inFlight.delete(publication.operationId);
        }
      });
      return promise;
    }
  };
}

function apiFromOctokit(client: OctokitClient): GitHubWriteApi {
  // write-adapter-client
  return {
    getRepository: (params) => {
      const getParams: Parameters<typeof client.rest.repos.get>[0] = {
        owner: params.owner,
        repo: params.repo
      };
      return client.rest.repos.get(getParams);
    },
    getReleaseByTag: (params) => {
      const getParams: Parameters<typeof client.rest.repos.getReleaseByTag>[0] = {
        owner: params.owner,
        repo: params.repo,
        tag: params.tag
      };
      return client.rest.repos.getReleaseByTag(getParams);
    },
    createRelease: (params) => {
      const createParams: Parameters<typeof client.rest.repos.createRelease>[0] = {
        owner: params.owner,
        repo: params.repo,
        tag_name: params.tag_name,
        name: params.name,
        body: params.body,
        draft: params.draft,
        prerelease: params.prerelease
      };
      return client.rest.repos.createRelease(createParams);
    }
  };
}

export function createGitHubPublisherFromOctokit(
  client: OctokitClient,
  scope: GitHubWriteScope
): GitHubPublisher {
  return createGitHubPublisher(apiFromOctokit(client), scope);
}

export function createLiveGitHubPublisher(
  options: LiveGitHubPublisherOptions
): GitHubPublisher {
  if (options.authToken.trim() === "") throw new Error("authToken is required");
  const client = new Octokit({
    auth: options.authToken,
    baseUrl: GITHUB_API_BASE_URL,
    userAgent: options.userAgent ?? "release-relay/github-integration"
  });
  return createGitHubPublisherFromOctokit(client, options);
}
