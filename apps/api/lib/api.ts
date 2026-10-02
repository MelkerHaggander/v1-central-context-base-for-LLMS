/**
 * Klientanrop mot /api. Samma kod i mock-läge och mot Alfredos API,
 * eftersom rewriten i next.config.ts avgör vart /api går.
 *
 * Regler:
 *  - credentials: "include" så sessionscookien följer med.
 *  - Nätverksfel och trasig JSON blir ett felobjekt, aldrig ett undantag i UI:t.
 *  - GET /api/memories returnerar en ren lista, INTE { data: [...] }.
 */
import { memoryBelongsToTab, USER_ID_HEADER } from "./tab-session";
import type {
  ApiError,
  LoginResponse,
  Member,
  MembersResponse,
  LogoutResponse,
  Memory,
  MemoryVersion,
  SearchInput,
  SessionResponse,
  Space,
  SpacesResponse,
} from "./types";
import { PAGE_SIZE, isApiError } from "./types";

const ACCOUNT_SWITCHED: ApiError = {
  error: {
    code: "ACCOUNT_SWITCHED",
    message: "Another account is signed in in this browser. Memories are not mixed.",
  },
};

const NETWORK_ERROR: ApiError = {
  error: { code: "NETWORK_ERROR", message: "Could not reach the server. Check the connection." },
};

/**
 * A body that is not JSON. A 404 or 405 without JSON is the framework's own
 * page for a route that does not exist. The mock/proxy in apps/dashboard turns
 * that into UPSTREAM_NO_ROUTE, but apps/api has no proxy, so the client names
 * it here: a missing endpoint, not a broken server.
 */
export function unreadableBody(status: number): ApiError {
  if (status === 404 || status === 405) {
    return { error: { code: "NO_ROUTE", message: `The server has no such endpoint (${status}).` } };
  }
  return {
    error: { code: "INVALID_RESPONSE", message: `The server answered ${status} without valid JSON.` },
  };
}

async function request<T>(input: string, init?: RequestInit): Promise<T | ApiError> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return NETWORK_ERROR;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unreadableBody(response.status);
  }

  if (isApiError(body)) return body;
  if (!response.ok) {
    return {
      error: { code: `HTTP_${response.status}`, message: `The server answered ${response.status}.` },
    };
  }
  return body as T;
}

export function login(email: string, password: string) {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return request<LogoutResponse>("/api/auth/logout", { method: "POST" });
}

export function session() {
  return request<SessionResponse>("/api/auth/session");
}

export async function searchMemories(params: SearchInput & { expectedUserId?: string }) {
  const search = new URLSearchParams();
  if (params.space_id) search.set("space_id", params.space_id);
  if (params.project) search.set("project", params.project);
  if (params.category) search.set("category", params.category);
  if (params.query) search.set("query", params.query);
  if (params.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  const path = `/api/memories${qs ? `?${qs}` : ""}`;

  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return NETWORK_ERROR;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unreadableBody(response.status);
  }

  if (isApiError(body)) return body;
  if (!response.ok) {
    return {
      error: { code: `HTTP_${response.status}`, message: `The server answered ${response.status}.` },
    };
  }
  const owner = response.headers.get(USER_ID_HEADER);
  if (params.expectedUserId && !memoryBelongsToTab(params.expectedUserId, owner)) {
    return ACCOUNT_SWITCHED;
  }
  return body as Memory[];
}

/* ------------------------------------------------------------------ *
 * V1.1 dashboard writes: create, edit, delete.
 *
 * docs/filip-auth.md owns this contract. All three ride the same cookie
 * session as the list, and the X-V1-User-Id header is checked the same way,
 * so a write can never land on an account this tab is not bound to.
 * There is no delete tool over MCP. Deleting is a dashboard-only action.
 * ------------------------------------------------------------------ */

/** Body shape for both create and edit. Partial updates do not exist. */
export type MemoryFields = {
  project: string;
  category: string;
  title: string;
  content: string;
  space_id?: string;
};

async function writeRequest<T>(
  path: string,
  init: RequestInit,
  expectedUserId?: string,
): Promise<T | ApiError> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch {
    return NETWORK_ERROR;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unreadableBody(response.status);
  }

  if (isApiError(body)) return body;
  if (!response.ok) {
    return {
      error: { code: `HTTP_${response.status}`, message: `Server answered ${response.status}.` },
    };
  }

  const owner = response.headers.get(USER_ID_HEADER);
  if (expectedUserId && !memoryBelongsToTab(expectedUserId, owner)) {
    return ACCOUNT_SWITCHED;
  }
  return body as T;
}

export function createMemory(fields: MemoryFields, expectedUserId?: string) {
  return writeRequest<Memory>(
    "/api/memories",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    },
    expectedUserId,
  );
}

export function updateMemory(
  id: string,
  fields: MemoryFields,
  expectedUserId?: string,
  allowProjectChange = false,
) {
  return writeRequest<Memory>(
    `/api/memories/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...fields,
        ...(allowProjectChange ? { allow_project_change: true } : {}),
      }),
    },
    expectedUserId,
  );
}

/**
 * The server has no undo. The view holds deletes back for a few seconds
 * (lib/delete-queue.ts) and asks for confirmation; this only sends the request.
 *
 * The two docs that describe this endpoint disagree on the wrapper: filip-auth.md
 * and the handover page say `{ "success": true }`, while logout uses
 * `{ "data": { "success": true } }`. Accept either rather than calling a
 * successful delete a failure over a wrapper.
 */
export async function deleteMemory(id: string, expectedUserId?: string) {
  const result = await writeRequest<{ success?: boolean; data?: { success?: boolean } }>(
    `/api/memories/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    expectedUserId,
  );
  if (isApiError(result)) return result;
  const ok = result?.success === true || result?.data?.success === true;
  if (!ok) {
    return {
      error: {
        code: "DELETE_UNCONFIRMED",
        message: "The server did not confirm the delete. Refresh before trying again.",
      },
    } satisfies ApiError;
  }
  return { success: true as const };
}

/**
 * The tab is closing and a delete is still waiting for its undo window to
 * end. Sent with keepalive so it survives the page going away. Nothing reads
 * the answer: if it fails, the memory is simply still there next time, which
 * is the safe way to fail.
 */
export function deleteMemoryOnUnload(id: string) {
  try {
    void fetch(`/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* fetch threw synchronously (quota for keepalive bodies); nothing to do */
  }
}

/** How many pages of 50 we are willing to walk for the globe and the totals. */
export const MAX_PAGES = 20;

export type AllMemories = {
  memories: Memory[];
  /** False when MAX_PAGES was reached and more rows may exist. */
  complete: boolean;
  pages: number;
};

/**
 * Every memory the account has, by walking `offset` until a short page arrives.
 *
 * The contract caps a response at 50 rows and offers no count, so this is the
 * only way to draw a globe of everything. It stops at MAX_PAGES and reports
 * `complete: false` rather than looping forever on a huge account.
 */
export async function fetchAllMemories(
  params: { project?: string; category?: string; query?: string; space_id?: string; expectedUserId?: string } = {},
): Promise<AllMemories | ApiError> {
  const memories: Memory[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await searchMemories({ ...params, offset: page * PAGE_SIZE });
    if (isApiError(result)) return result;

    // Rows can shift between pages while the model writes. Dedupe by id so a
    // shifted row is never counted twice.
    for (const memory of result) {
      if (seen.has(memory.id)) continue;
      seen.add(memory.id);
      memories.push(memory);
    }

    if (result.length < PAGE_SIZE) {
      return { memories, complete: true, pages: page + 1 };
    }
  }

  return { memories, complete: false, pages: MAX_PAGES };
}

/* ------------------------------------------------------------------ *
 * v1.2: spaces and history.
 *
 * GET /api/spaces is Alfredo's (PR #40): { spaces: [{ id, kind }] }, personal
 * first, derived from the session. The dashboard never sends a user id.
 *
 * GET /api/memories/:id/versions is Melker's (c31e656): a plain list, newest
 * first, text only. It answers 404 once the memory itself is deleted, even
 * though the rows stay in memory_versions, because the access check looks the
 * space up on the live row.
 * ------------------------------------------------------------------ */

function isSpace(value: unknown): value is Space {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Space).id === "string" &&
    ((value as Space).kind === "personal" || (value as Space).kind === "shared")
  );
}

export async function fetchSpaces(expectedUserId?: string): Promise<Space[] | ApiError> {
  const result = await writeRequest<SpacesResponse>("/api/spaces", { method: "GET" }, expectedUserId);
  if (isApiError(result)) return result;
  // Only the fields the view uses, and name only when it is real text.
  const list = Array.isArray(result?.spaces)
    ? result.spaces.filter(isSpace).map((s) => ({
        id: s.id,
        kind: s.kind,
        ...(typeof s.name === "string" && s.name.trim() ? { name: s.name.trim() } : {}),
      }))
    : null;
  if (!list) {
    return {
      error: { code: "INVALID_RESPONSE", message: "The server answered without a spaces list." },
    };
  }
  return list;
}

export async function fetchVersions(id: string, expectedUserId?: string): Promise<MemoryVersion[] | ApiError> {
  const result = await writeRequest<MemoryVersion[]>(
    `/api/memories/${encodeURIComponent(id)}/versions`,
    { method: "GET" },
    expectedUserId,
  );
  if (isApiError(result)) return result;
  if (!Array.isArray(result)) {
    return {
      error: { code: "INVALID_RESPONSE", message: "The server answered without a version list." },
    };
  }
  return [...result].sort((a, b) => b.version_number - a.version_number);
}

/**
 * GET /api/memories/deleted?space_id=. What was deleted in a space, with the
 * text it had and who deleted it. Newest first. The API keeps it in
 * memory_versions; a deleted memory is gone from the list and the globe.
 */
export async function fetchDeleted(spaceId: string, expectedUserId?: string): Promise<MemoryVersion[] | ApiError> {
  const result = await writeRequest<MemoryVersion[]>(
    `/api/memories/deleted?space_id=${encodeURIComponent(spaceId)}`,
    { method: "GET" },
    expectedUserId,
  );
  if (isApiError(result)) return result;
  if (!Array.isArray(result)) {
    return {
      error: { code: "INVALID_RESPONSE", message: "The server answered without a list of deleted memories." },
    };
  }
  return result
    .filter((v) => v.event === "delete")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/* ------------------------------------------------------------------ *
 * Proposed: teams and members ("Förslag: team och medlemmar").
 *
 * GET /api/spaces/:id/members exists. Create, rename, add and remove do not.
 * A missing write comes back as a 404 page. The view shows the team buttons
 * once the members list answers.
 * ------------------------------------------------------------------ */

/**
 * True only when the server says it has no such endpoint. A 5xx, a gateway
 * page or a bad body is a failure and must say so, never "not built yet".
 * UPSTREAM_NO_ROUTE comes from lib/upstream.ts (the proxy in apps/dashboard)
 * and NO_ROUTE from unreadableBody (apps/api, no proxy), both for a non-JSON
 * 404 or 405.
 */
export function isMissingEndpoint(error: ApiError["error"]): boolean {
  return (
    error.code === "UPSTREAM_NO_ROUTE" ||
    error.code === "NO_ROUTE" ||
    error.code === "HTTP_404" ||
    error.code === "HTTP_405"
  );
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function createTeam(name: string, expectedUserId?: string) {
  return writeRequest<Space>("/api/spaces", { method: "POST", ...json({ name }) }, expectedUserId);
}

export function renameTeam(id: string, name: string, expectedUserId?: string) {
  return writeRequest<Space>(
    `/api/spaces/${encodeURIComponent(id)}`,
    { method: "PATCH", ...json({ name }) },
    expectedUserId,
  );
}

export async function fetchMembers(id: string, expectedUserId?: string): Promise<Member[] | ApiError> {
  const result = await writeRequest<MembersResponse>(
    `/api/spaces/${encodeURIComponent(id)}/members`,
    { method: "GET" },
    expectedUserId,
  );
  if (isApiError(result)) return result;
  if (!Array.isArray(result?.members)) {
    return { error: { code: "INVALID_RESPONSE", message: "The server answered without a member list." } };
  }
  return result.members.filter(
    (m): m is Member => typeof m?.user_id === "string" && typeof m?.email === "string",
  );
}

export function addMember(id: string, email: string, expectedUserId?: string) {
  return writeRequest<Member>(
    `/api/spaces/${encodeURIComponent(id)}/members`,
    { method: "POST", ...json({ email }) },
    expectedUserId,
  );
}

export function removeMember(id: string, userId: string, expectedUserId?: string) {
  return writeRequest<{ success?: boolean }>(
    `/api/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    expectedUserId,
  );
}
