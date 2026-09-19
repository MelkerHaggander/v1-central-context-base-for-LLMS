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
  LogoutResponse,
  Memory,
  SearchInput,
  SessionResponse,
} from "./types";
import { PAGE_SIZE, isApiError } from "./types";

const ACCOUNT_SWITCHED: ApiError = {
  error: {
    code: "ACCOUNT_SWITCHED",
    message: "Ett annat konto är inloggat i den här webbläsaren. Minnen blandas inte.",
  },
};

const NETWORK_ERROR: ApiError = {
  error: { code: "NETWORK_ERROR", message: "Kunde inte nå servern. Kontrollera anslutningen." },
};

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
    return {
      error: {
        code: "INVALID_RESPONSE",
        message: `Servern svarade ${response.status} utan giltig JSON.`,
      },
    };
  }

  if (isApiError(body)) return body;
  if (!response.ok) {
    return {
      error: { code: `HTTP_${response.status}`, message: `Servern svarade ${response.status}.` },
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
    return {
      error: {
        code: "INVALID_RESPONSE",
        message: `Servern svarade ${response.status} utan giltig JSON.`,
      },
    };
  }

  if (isApiError(body)) return body;
  if (!response.ok) {
    return {
      error: { code: `HTTP_${response.status}`, message: `Servern svarade ${response.status}.` },
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
    return {
      error: {
        code: "INVALID_RESPONSE",
        message: `Server answered ${response.status} without valid JSON.`,
      },
    };
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

export function updateMemory(id: string, fields: MemoryFields, expectedUserId?: string) {
  return writeRequest<Memory>(
    `/api/memories/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    },
    expectedUserId,
  );
}

/**
 * Deleting cannot be undone and there is no history. The confirm step lives in
 * the view, not here.
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
  params: { project?: string; category?: string; query?: string; expectedUserId?: string } = {},
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
