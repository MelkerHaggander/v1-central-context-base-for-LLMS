import type { MemoryRecord, MemoryStore, NormalizedMemoryInput } from "@v1/memory";
import { createSupabaseAnonClient } from "@/lib/supabase/clients";

function asIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function asMemory(value: unknown): MemoryRecord | null {
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

/**
 * Memory store keyed by the opaque MCP access token.
 * Does not use a Supabase user JWT, so Claude keeps working after that JWT dies.
 */
export function createMcpTokenStore(mcpAccess: string): MemoryStore {
  const supabase = createSupabaseAnonClient();

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
      if (!Array.isArray(data)) return [];
      return data.map(asMemory).filter((row): row is MemoryRecord => row !== null);
    },
  };
}
