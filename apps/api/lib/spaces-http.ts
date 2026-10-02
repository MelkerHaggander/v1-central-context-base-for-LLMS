export type SpaceKind = "personal" | "shared";

export type MemberSpace = {
  id: string;
  kind: SpaceKind;
  /** Optional display name; UI falls back to "Team" when null. */
  name?: string | null;
};

export type SpaceListResult = {
  status: number;
  body: { spaces: MemberSpace[] } | { error: { code: string; message: string } };
};

type SpaceDb = {
  from(table: string): {
    select(columns: string): any;
  };
};

const KIND_ORDER: Record<SpaceKind, number> = { personal: 0, shared: 1 };

/** Same 1–60 rule as the dashboard (TEAM_NAME_MAX). */
export const TEAM_NAME_MAX = 60;

export type TeamNameResult =
  | { ok: true; name: string }
  | { ok: false; code: "INVALID_NAME"; message: string };

export function parseTeamName(raw: unknown): TeamNameResult {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > TEAM_NAME_MAX) {
    return { ok: false, code: "INVALID_NAME", message: "Team name must be 1–60 characters." };
  }
  return { ok: true, name };
}

function asKind(value: string): SpaceKind | null {
  return value === "personal" || value === "shared" ? value : null;
}

export async function loadMemberSpaces(client: SpaceDb, userId: string): Promise<MemberSpace[]> {
  const members = await client.from("space_members").select("space_id").eq("user_id", userId);
  if (members.error) throw new Error(members.error.message);
  const ids = (members.data ?? []).map((row: { space_id: string }) => row.space_id).filter(Boolean);
  if (ids.length === 0) return [];
  // Prefer name when the column exists; fall back so login still works
  // before 20261001180000_spaces_name.sql has been applied.
  let spaces = await client.from("spaces").select("id, kind, name").in("id", ids);
  if (spaces.error) {
    spaces = await client.from("spaces").select("id, kind").in("id", ids);
  }
  if (spaces.error) throw new Error(spaces.error.message);
  return (spaces.data ?? []).flatMap((row: { id: string; kind: string; name?: string | null }) => {
    const kind = asKind(row.kind);
    return kind ? [{ id: row.id, kind, name: row.name ?? null }] : [];
  });
}

export type SpaceMember = {
  user_id: string;
  email: string;
};

/** GET /api/spaces/:id/members. Emails sorted so the list does not jump. */
export function listSpaceMembers(rows: SpaceMember[]): { members: SpaceMember[] } {
  const seen = new Set<string>();
  const members = rows
    .filter((row) => row.user_id.trim() && row.email.trim())
    .filter((row) => {
      if (seen.has(row.user_id)) return false;
      seen.add(row.user_id);
      return true;
    })
    .map((row) => ({ user_id: row.user_id, email: row.email }))
    .sort((a, b) => a.email.localeCompare(b.email, "sv"));
  return { members };
}

export function listMemberSpaces(rows: MemberSpace[]): SpaceListResult {
  const seen = new Set<string>();
  const spaces = rows
    .filter((row) => row.id.trim() && (row.kind === "personal" || row.kind === "shared"))
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name ?? null,
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
  return { status: 200, body: { spaces } };
}
