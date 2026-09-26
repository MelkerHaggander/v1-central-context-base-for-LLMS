import {
  toIso,
  type MemoryIdentity,
  type MemoryRecord,
  type MemoryStore,
  type MemoryVersion,
  type NearestHit,
  type NormalizedMemoryInput,
  type SubjectWrite,
} from "@v1/memory";
import { createSupabaseAnonClient } from "@/lib/supabase/clients";

type RpcResult = { data: unknown; error: { message: string } | null };

export type McpRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
};

function asIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return toIso(value);
  } catch {
    return value;
  }
}

export function asMemory(value: unknown): MemoryRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const created_at = asIso(row.created_at);
  const updated_at = asIso(row.updated_at);
  if (
    typeof row.id !== "string" ||
    typeof row.project !== "string" ||
    typeof row.category !== "string" ||
    typeof row.title !== "string" ||
    typeof row.content !== "string" ||
    !created_at ||
    !updated_at
  ) {
    return null;
  }
  return {
    id: row.id,
    project: row.project,
    category: row.category as MemoryRecord["category"],
    title: row.title,
    content: row.content,
    created_at,
    updated_at,
  };
}

function asHit(value: unknown): NearestHit | null {
  if (!value || typeof value !== "object") return null;
  const row = asMemory(value);
  const similarity = Number((value as { similarity?: unknown }).similarity);
  if (!row || Number.isNaN(similarity)) return null;
  return { row, similarity };
}

function asIdentity(value: unknown): MemoryIdentity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const updated_at = asIso(row.updated_at);
  if (
    typeof row.project !== "string" ||
    typeof row.category !== "string" ||
    typeof row.title !== "string" ||
    !updated_at
  ) {
    return null;
  }
  return {
    project: row.project,
    category: row.category as MemoryIdentity["category"],
    title: row.title,
    updated_at,
  };
}

function asVersion(value: unknown): MemoryVersion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const created_at = asIso(row.created_at);
  if (
    typeof row.version_number !== "number" ||
    typeof row.memory_id !== "string" ||
    typeof row.changed_by !== "string" ||
    (row.event !== "update" && row.event !== "delete") ||
    typeof row.project !== "string" ||
    typeof row.category !== "string" ||
    typeof row.title_before !== "string" ||
    typeof row.title_after !== "string" ||
    typeof row.content_before !== "string" ||
    typeof row.content_after !== "string" ||
    !created_at
  ) {
    return null;
  }
  const source = row.source === "dashboard" || row.source === "brain" ? row.source : null;
  return {
    version_number: row.version_number,
    memory_id: row.memory_id,
    space_id: typeof row.space_id === "string" ? row.space_id : null,
    changed_by: row.changed_by,
    event: row.event,
    project: row.project,
    category: row.category as MemoryVersion["category"],
    title_before: row.title_before,
    title_after: row.title_after,
    content_before: row.content_before,
    content_after: row.content_after,
    source,
    created_at,
  };
}

function rowsOf<T>(data: unknown, map: (value: unknown) => T | null): T[] {
  if (!Array.isArray(data)) return [];
  return data.map(map).filter((row): row is T => row !== null);
}

/**
 * Memory store keyed by the opaque MCP access token.
 * Does not use a Supabase user JWT, so Claude keeps working after that JWT dies.
 * The optional client is for tests. Production uses the anon client and the mcp_* RPCs.
 */
export function createMcpTokenStore(mcpAccess: string, supabase: McpRpcClient = createSupabaseAnonClient()): MemoryStore {

  return {
    async insert(_userId, fields: NormalizedMemoryInput) {
      const { data, error } = await supabase.rpc("mcp_insert_memory", {
        p_access: mcpAccess,
        p_project: fields.project,
        p_category: fields.category,
        p_title: fields.title,
        p_content: fields.content,
      });
      if (error || !data) {
        return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
      }
      const body = data as { kind?: string; row?: unknown };
      if (body.kind === "duplicate") return { kind: "duplicate" };
      const row = asMemory(body.row);
      if (body.kind === "created" && row) return { kind: "created", row };
      return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
    },

    async findIdentical(_userId, fields: NormalizedMemoryInput) {
      const { data, error } = await supabase.rpc("mcp_find_identical_memory", {
        p_access: mcpAccess,
        p_project: fields.project,
        p_category: fields.category,
        p_title: fields.title,
        p_content: fields.content,
      });
      if (error || !data) return null;
      return asMemory(data);
    },

    async update(_userId, id, fields: NormalizedMemoryInput) {
      const { data, error } = await supabase.rpc("mcp_update_memory", {
        p_access: mcpAccess,
        p_id: id,
        p_project: fields.project,
        p_category: fields.category,
        p_title: fields.title,
        p_content: fields.content,
      });
      if (error || !data) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      const body = data as { kind?: string; row?: unknown };
      if (body.kind === "missing") return { kind: "missing" };
      const row = asMemory(body.row);
      if (body.kind === "updated" && row) return { kind: "updated", row };
      return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
    },

    async remove() {
      // MCP-token får aldrig radera. Radering finns bara via inloggad dashboard-session.
      return { kind: "missing" };
    },

    async listByUser() {
      const { data, error } = await supabase.rpc("mcp_list_memories", { p_access: mcpAccess });
      if (error || data == null) {
        throw new Error(error?.message ?? "mcp_list_memories failed");
      }
      return rowsOf(data, asMemory);
    },

    async listBySpaces(_userId, spaceIds) {
      const { data, error } = await supabase.rpc("mcp_list_by_spaces", {
        p_access: mcpAccess,
        p_space_ids: spaceIds,
      });
      if (error || data == null) throw new Error(error?.message ?? "mcp_list_by_spaces failed");
      return rowsOf(data, asMemory);
    },

    async listNearest(_userId, embedding, spaceIds, limit) {
      const { data, error } = await supabase.rpc("mcp_list_nearest", {
        p_access: mcpAccess,
        p_query_embedding: embedding,
        p_space_ids: spaceIds,
        p_match_count: limit,
      });
      if (error || data == null) throw new Error(error?.message ?? "mcp_list_nearest failed");
      return rowsOf(data, asHit);
    },

    async listNeighbors(_userId, seedIds, spaceIds, minSimilarity, limit) {
      const { data, error } = await supabase.rpc("mcp_list_neighbors", {
        p_access: mcpAccess,
        p_seed_ids: seedIds,
        p_space_ids: spaceIds,
        p_min_similarity: minSimilarity,
        p_match_count: limit,
      });
      if (error || data == null) throw new Error(error?.message ?? "mcp_list_neighbors failed");
      return rowsOf(data, asHit);
    },

    async listIdentities(_userId, spaceIds, limit) {
      const { data, error } = await supabase.rpc("mcp_list_identities", {
        p_access: mcpAccess,
        p_space_ids: spaceIds,
        p_limit: limit,
      });
      if (error || data == null) throw new Error(error?.message ?? "mcp_list_identities failed");
      return rowsOf(data, asIdentity);
    },

    async upsertSubject(_userId, fields: SubjectWrite) {
      const { data, error } = await supabase.rpc("mcp_upsert_subject", {
        p_access: mcpAccess,
        p_space_id: fields.spaceId,
        p_project: fields.project,
        p_category: fields.category,
        p_title: fields.title,
        p_content: fields.content,
        p_source: fields.source,
      });
      if (error || !data) {
        return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
      }
      const body = data as { kind?: string; row?: unknown };
      const row = asMemory(body.row);
      if ((body.kind === "created" || body.kind === "updated" || body.kind === "unchanged") && row) {
        return { kind: body.kind, row };
      }
      return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
    },

    async setEmbedding(id, embedding) {
      const { error } = await supabase.rpc("mcp_set_embedding", {
        p_access: mcpAccess,
        p_id: id,
        p_embedding: embedding,
      });
      if (error) throw new Error(error.message);
    },

    async hasEmbedding(id) {
      const { data, error } = await supabase.rpc("mcp_has_embedding", {
        p_access: mcpAccess,
        p_id: id,
      });
      if (error) throw new Error(error.message);
      return data === true;
    },

    async listVersions(memoryId) {
      const { data, error } = await supabase.rpc("mcp_list_versions", {
        p_access: mcpAccess,
        p_id: memoryId,
      });
      if (error || data == null) throw new Error(error?.message ?? "mcp_list_versions failed");
      return rowsOf(data, asVersion);
    },

    async spaceOf(memoryId) {
      const { data, error } = await supabase.rpc("mcp_space_of", {
        p_access: mcpAccess,
        p_id: memoryId,
      });
      if (error) throw new Error(error.message);
      return typeof data === "string" ? data : null;
    },
  };
}
