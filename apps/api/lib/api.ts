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
import { isApiError } from "./types";

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
