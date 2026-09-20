/**
 * Låst V1-kontrakt. Speglar docs/contracts.md. Ändra inte utan överenskommelse.
 */

export const CATEGORIES = ["fact", "decision", "goal", "deadline", "preference", "lesson"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Svenska etiketter i dashboarden. Värdena mot API:t är alltid engelska gemener. */
export const CATEGORY_LABELS: Record<Category, string> = {
  fact: "Faktum",
  decision: "Beslut",
  goal: "Mål",
  deadline: "Deadline",
  preference: "Preferens",
  lesson: "Lärdom",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** Ett minne som det ser ut i svar till klienten. Aldrig user_id. */
export type Memory = {
  id: string;
  project: string;
  category: Category;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type MemoryInput = {
  project: string;
  category: string;
  title: string;
  content: string;
};

export type UpdateMemoryInput = MemoryInput & {
  id: string;
  allow_project_change?: boolean;
};

export type SearchInput = {
  project?: string;
  category?: string;
  query?: string;
  offset?: number;
};

export type ApiError = { error: { code: string; message: string } };

export type SessionUser = { id: string; email: string };

/** { data: user } inloggad, { data: null } inte inloggad. */
export type SessionResponse = { data: SessionUser | null };
export type LoginResponse = { data: SessionUser } | ApiError;
export type LogoutResponse = { data: { success: true } } | ApiError;

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error?.code === "string"
  );
}

export const PAGE_SIZE = 50;
