import type { SpaceAccess, SpaceKind, SpaceRef } from "@v1/memory";

type SpaceDb = {
  from(table: string): {
    select(columns: string): any;
  };
};

export function createSupabaseSpaceAccess(client: SpaceDb): SpaceAccess {
  async function readableSpaceIds(userId: string): Promise<string[]> {
    const result = await client.from("space_members").select("space_id").eq("user_id", userId);
    if (result.error) throw new Error(result.error.message);
    return (result.data ?? []).map((row: { space_id: string }) => row.space_id).filter(Boolean);
  }

  async function listSpaces(userId: string): Promise<SpaceRef[]> {
    const ids = await readableSpaceIds(userId);
    if (ids.length === 0) return [];
    const spaces = await client.from("spaces").select("id, kind").in("id", ids);
    if (spaces.error) throw new Error(spaces.error.message);
    return (spaces.data ?? []).flatMap((row: { id: string; kind: string }) => {
      if (row.kind !== "personal" && row.kind !== "shared") return [];
      const kind: SpaceKind = row.kind;
      return [{ id: row.id, kind }];
    });
  }

  return {
    readableSpaceIds,
    listSpaces,
    async spaceFor(userId, kind) {
      const spaces = await listSpaces(userId);
      const matches = spaces.filter((row) => row.kind === kind);
      if (kind === "shared" && matches.length !== 1) return null;
      return matches[0]?.id ?? null;
    },
    async isMember(userId, spaceId) {
      const result = await client
        .from("space_members")
        .select("user_id")
        .eq("user_id", userId)
        .eq("space_id", spaceId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return Boolean(result.data);
    },
  };
}
