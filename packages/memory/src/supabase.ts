import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryRecord } from "./types";
import type { MemoryStore } from "./store";
import { toIso } from "./time";

const MEMORY_COLUMNS =
  "id, project, category, title, content, created_at, updated_at" as const;

function asMemory(row: MemoryRecord): MemoryRecord {
  return {
    id: row.id,
    project: row.project,
    category: row.category,
    title: row.title,
    content: row.content,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export function createSupabaseStore(client: { from: SupabaseClient["from"] }): MemoryStore {
  return {
    async insert(_userId, fields) {
      const inserted = await client.from("memories").insert(fields).select(MEMORY_COLUMNS).single();

      if (!inserted.error && inserted.data) {
        return { kind: "created", row: asMemory(inserted.data as MemoryRecord) };
      }
      if (inserted.error?.code === "23505") {
        return { kind: "duplicate" };
      }
      return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
    },

    async findIdentical(_userId, fields) {
      const existing = await client
        .from("memories")
        .select(MEMORY_COLUMNS)
        .eq("project", fields.project)
        .eq("category", fields.category)
        .eq("title", fields.title)
        .eq("content", fields.content)
        .maybeSingle();

      return existing.data ? asMemory(existing.data as MemoryRecord) : null;
    },

    async update(_userId, id, fields) {
      const result = await client
        .from("memories")
        .update(fields)
        .eq("id", id)
        .select(MEMORY_COLUMNS)
        .maybeSingle();

      if (result.error) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      if (!result.data) {
        return { kind: "missing" };
      }
      return { kind: "updated", row: asMemory(result.data as MemoryRecord) };
    },

    async remove(_userId, id) {
      const result = await client.from("memories").delete().eq("id", id).select("id").maybeSingle();

      if (result.error) {
        return { kind: "failed", code: "DELETE_FAILED", message: "Kunde inte radera minnet." };
      }
      if (!result.data) {
        return { kind: "missing" };
      }
      return { kind: "deleted" };
    },

    async listByUser(_userId) {
      const result = await client.from("memories").select(MEMORY_COLUMNS);
      if (result.error) {
        throw new Error(result.error.message);
      }
      return ((result.data ?? []) as MemoryRecord[]).map(asMemory);
    },
  };
}
