import {
  createMemoryApi,
  type EmbeddingClient,
  type MemoryFormulator,
  type MemoryInput,
  type MemoryStore,
  type SpaceAccess,
} from "@v1/memory";

export type MemoryHttpDeps = {
  store: MemoryStore;
  spaces: SpaceAccess;
  embedding?: EmbeddingClient;
  formulator?: MemoryFormulator;
};

export type HttpResult = {
  status: number;
  body: unknown;
};

function errorBody(code: string, message: string, status: number): HttpResult {
  return { status, body: { error: { code, message } } };
}

function spaceIdOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fieldsOf(body: Record<string, unknown>): MemoryInput {
  return {
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
  };
}

function apiFor(deps: MemoryHttpDeps) {
  return createMemoryApi(deps.store, {
    spaces: deps.spaces,
    embedding: deps.embedding,
    formulator: deps.formulator,
  });
}

export async function getMemories(
  userId: string,
  url: URL,
  deps: MemoryHttpDeps,
): Promise<HttpResult> {
  const spaceId = spaceIdOf(url.searchParams.get("space_id"));
  if (!spaceId) {
    return errorBody("INVALID_SPACE", "space_id krävs.", 400);
  }
  const offsetRaw = url.searchParams.get("offset");
  const result = await apiFor(deps).searchInSpace(userId, spaceId, {
    project: url.searchParams.get("project") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    query: url.searchParams.get("query") ?? undefined,
    offset: offsetRaw == null || offsetRaw === "" ? 0 : Number(offsetRaw),
  });
  if ("error" in result) {
    const status = result.error.code === "FORBIDDEN" ? 403 : 400;
    return errorBody(result.error.code, result.error.message, status);
  }
  return { status: 200, body: result.data };
}

export async function postMemory(
  userId: string,
  body: Record<string, unknown>,
  deps: MemoryHttpDeps,
): Promise<HttpResult> {
  const spaceId = spaceIdOf(body.space_id);
  if (!spaceId) {
    return errorBody("INVALID_SPACE", "space_id krävs.", 400);
  }
  const result = await apiFor(deps).saveDashboardMemory(userId, fieldsOf(body), spaceId);
  if ("error" in result) {
    const status =
      result.error.code === "FORBIDDEN" ? 403 : result.error.code.startsWith("INVALID_") ? 400 : 500;
    return errorBody(result.error.code, result.error.message, status);
  }
  return { status: 201, body: result.data };
}

export async function patchMemory(
  userId: string,
  id: string,
  body: Record<string, unknown>,
  deps: MemoryHttpDeps,
): Promise<HttpResult> {
  const result = await apiFor(deps).updateMemory(userId, {
    id,
    ...fieldsOf(body),
    allow_project_change: body.allow_project_change === true,
  });
  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code.startsWith("INVALID_") ||
              result.error.code === "PROJECT_CHANGE_REQUIRES_FLAG" ||
              result.error.code === "LESSON_CATEGORY_REQUIRES_TOOL"
            ? 400
            : 500;
    return errorBody(result.error.code, result.error.message, status);
  }
  return { status: 200, body: result.data };
}

export async function deleteMemoryHttp(
  userId: string,
  id: string,
  deps: MemoryHttpDeps,
): Promise<HttpResult> {
  const result = await apiFor(deps).deleteMemory(userId, id);
  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code.startsWith("INVALID_")
            ? 400
            : 500;
    return errorBody(result.error.code, result.error.message, status);
  }
  return { status: 200, body: result.data };
}

export async function getMemoryVersions(
  userId: string,
  id: string,
  deps: MemoryHttpDeps,
): Promise<HttpResult> {
  const result = await apiFor(deps).listVersions(userId, id);
  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code.startsWith("INVALID_")
            ? 400
            : 500;
    return errorBody(result.error.code, result.error.message, status);
  }
  return { status: 200, body: result.data };
}
