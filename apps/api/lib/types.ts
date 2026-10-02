/**
 * Låst V1-kontrakt. Speglar docs/contracts.md. Ändra inte utan överenskommelse.
 */

export const CATEGORIES = ["fact", "decision", "goal", "deadline", "preference", "lesson"] as const;
export type Category = (typeof CATEGORIES)[number];

/** English labels in the dashboard. Wire values against the API stay lowercase English. */
export const CATEGORY_LABELS: Record<Category, string> = {
  fact: "Fact",
  decision: "Decision",
  goal: "Goal",
  deadline: "Deadline",
  preference: "Preference",
  lesson: "Lesson",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** Ett minne som det ser ut i svar till klienten. Aldrig fältnamnet user_id. */
export type Memory = {
  id: string;
  project: string;
  category: Category;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  /**
   * v1.2. Set when the row is created and never changed by an edit.
   * GET /api/memories on c31e656 selects MEMORY_COLUMNS, which does not include
   * it, so a list row usually arrives without it. Optional on purpose.
   */
  source?: MemorySource | null;
  space_id?: string | null;
  /**
   * Auth user id of the creator. Present on team list rows so the panel can
   * resolve an email via GET /api/spaces/:id/members (same map as Last change).
   */
  created_by?: string;
};

/* ------------------------------------------------------------------ *
 * v1.2: spaces and history. Backend features (Confluence 146374658),
 * Alfredo PR #40 for GET /api/spaces, Melker c31e656 for versions.
 * ------------------------------------------------------------------ */

export type SpaceKind = "personal" | "shared";

/**
 * GET /api/spaces -> { spaces: Space[] }. Personal first.
 * `name` is part of the team proposal to Alfredo (a nullable name column on
 * spaces). PR #40 does not send it, so it is optional and the view falls back
 * to "Team".
 */
export type Space = { id: string; kind: SpaceKind; name?: string | null };

/** Proposed: GET /api/spaces/:id/members -> { members: Member[] }. */
export type Member = { user_id: string; email: string };
export type MembersResponse = { members: Member[] };
export type SpacesResponse = { spaces: Space[] };

export type MemorySource = "dashboard" | "brain";

export type MemoryVersionEvent = "update" | "delete";

/** GET /api/memories/:id/versions -> MemoryVersion[], newest first. Text only. */
export type MemoryVersion = {
  version_number: number;
  memory_id: string;
  space_id: string | null;
  /** Auth user id of whoever made the change. There is no users endpoint, so no name. */
  changed_by: string;
  event: MemoryVersionEvent;
  project: string;
  category: Category;
  title_before: string;
  title_after: string;
  content_before: string;
  content_after: string;
  source: MemorySource | null;
  created_at: string;
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
  space_id?: string;
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
