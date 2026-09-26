import type { SpaceAccess, SpaceKind } from "@v1/memory";

type QueryResult<T> = { data: T | null; error: { message: string } | null };

type SpaceQuery = {
  select(columns: string): SpaceQuery;
  eq(column: string, value: string): SpaceQuery;
  in(column: string, values: string[]): PromiseLike<QueryResult<Array<{ id: string; kind: SpaceKind }>>>;
  maybeSingle(): PromiseLike<QueryResult<{ user_id?: string }>>;
  then<T>(
    onfulfilled?: ((value: QueryResult<Array<{ space_id: string }>>) => T | PromiseLike<T>) | null,
  ): PromiseLike<T>;
};

type MemberClient = {
  from(table: string): SpaceQuery;
};

export function createSupabaseSpaceAccess(client: MemberClient): SpaceAccess {
  return {
    async readableSpaceIds(userId) {
      const result = await client.from("space_members").select("space_id").eq("user_id", userId);
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []).map((row) => row.space_id).filter(Boolean);
    },

    async spaceFor(userId, kind) {
      const ids = await this.readableSpaceIds(userId);
      if (ids.length === 0) return null;
      const spaces = await client.from("spaces").select("id, kind").in("id", ids);
      if (spaces.error) throw new Error(spaces.error.message);
      return (spaces.data ?? []).find((row) => row.kind === kind)?.id ?? null;
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
