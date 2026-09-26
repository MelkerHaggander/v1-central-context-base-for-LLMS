import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MemoryIdentity,
  MemoryRecord,
  MemorySource,
  MemoryVersion,
  SubjectWrite,
} from "./types";
import type { MemoryStore, NearestHit } from "./store";
import { toIso } from "./time";

const MEMORY_COLUMNS =
  "id, project, category, title, content, created_at, updated_at" as const;

const VERSION_COLUMNS =
  "version_number, space_id, project, category, title, content, source, created_at" as const;

type Db = {
  from: SupabaseClient["from"];
  rpc?: SupabaseClient["rpc"];
};

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

function asVersion(row: MemoryVersion): MemoryVersion {
  return {
    version_number: row.version_number,
    space_id: row.space_id,
    project: row.project,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    created_at: toIso(row.created_at),
  };
}

function asHit(row: MemoryRecord & { similarity?: number }): NearestHit {
  return { row: asMemory(row), similarity: Number(row.similarity ?? 0) };
}

async function nextVersionNumber(client: Db, memoryId: string): Promise<number> {
  const existing = await client
    .from("memory_versions")
    .select("version_number")
    .eq("memory_id", memoryId);
  if (existing.error) return 1;
  const numbers = ((existing.data ?? []) as Array<{ version_number?: number }>).map(
    (row) => row.version_number ?? 0,
  );
  return Math.max(0, ...numbers) + 1;
}

async function insertVersion(
  client: Db,
  row: MemoryRecord & { space_id?: string | null; source?: MemorySource | null },
): Promise<{ error: { message: string } | null }> {
  const versionNumber = await nextVersionNumber(client, row.id);
  const inserted = await client.from("memory_versions").insert({
    memory_id: row.id,
    space_id: row.space_id ?? null,
    project: row.project,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source ?? null,
    version_number: versionNumber,
  });
  return { error: inserted.error };
}

export function createSupabaseStore(client: Db): MemoryStore {
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
      const existing = await client
        .from("memories")
        .select(MEMORY_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (existing.error) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      if (!existing.data) return { kind: "missing" };
      const current = asMemory(existing.data as MemoryRecord);
      const unchanged =
        current.project === fields.project &&
        current.category === fields.category &&
        current.title === fields.title &&
        current.content === fields.content;
      if (unchanged) return { kind: "updated", row: current };

      if (current.title !== fields.title || current.content !== fields.content) {
        const versioned = await insertVersion(client, current);
        if (versioned.error) {
          return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
        }
      }

      const result = await client
        .from("memories")
        .update(fields)
        .eq("id", id)
        .select(MEMORY_COLUMNS)
        .maybeSingle();

      if (result.error) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      if (!result.data) return { kind: "missing" };
      return { kind: "updated", row: asMemory(result.data as MemoryRecord) };
    },

    async updateById(id, fields) {
      return this.update("", id, fields);
    },

    async remove(_userId, id) {
      const result = await client.from("memories").delete().eq("id", id).select("id").maybeSingle();

      if (result.error) {
        return { kind: "failed", code: "DELETE_FAILED", message: "Kunde inte radera minnet." };
      }
      if (!result.data) return { kind: "missing" };
      return { kind: "deleted" };
    },

    async removeById(id) {
      return this.remove("", id);
    },

    async listByUser(_userId) {
      const result = await client.from("memories").select(MEMORY_COLUMNS);
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as MemoryRecord[]).map(asMemory);
    },

    async listBySpaces(_userId, spaceIds) {
      const result = await client
        .from("memories")
        .select(MEMORY_COLUMNS)
        .in("space_id", spaceIds);
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as MemoryRecord[]).map(asMemory);
    },

    async listNearest(_userId, embedding, spaceIds, limit) {
      if (!client.rpc) throw new Error("match_memories unavailable");
      const result = await client.rpc("match_memories", {
        query_embedding: embedding,
        space_ids: spaceIds,
        match_count: limit,
      });
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as Array<MemoryRecord & { similarity?: number }>).map(asHit);
    },

    async listNeighbors(_userId, seedIds, spaceIds, minSimilarity, limit) {
      if (!client.rpc) throw new Error("match_memory_neighbors unavailable");
      const result = await client.rpc("match_memory_neighbors", {
        seed_ids: seedIds,
        space_ids: spaceIds,
        min_similarity: minSimilarity,
        match_count: limit,
      });
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as Array<MemoryRecord & { similarity?: number }>).map(asHit);
    },

    async listIdentities(_userId, spaceIds, limit) {
      const result = await client
        .from("memories")
        .select("project, category, title, updated_at")
        .in("space_id", spaceIds)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as MemoryIdentity[]).map((row) => ({
        project: row.project,
        category: row.category,
        title: row.title,
        updated_at: toIso(row.updated_at),
      }));
    },

    async upsertSubject(userId, fields: SubjectWrite) {
      const existing = await client
        .from("memories")
        .select(`${MEMORY_COLUMNS}, space_id, source`)
        .eq("space_id", fields.spaceId)
        .eq("project", fields.project)
        .eq("category", fields.category)
        .eq("title", fields.title)
        .maybeSingle();
      if (existing.error) {
        return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
      }

      if (existing.data) {
        const current = asMemory(existing.data as MemoryRecord);
        const meta = existing.data as { space_id?: string | null; source?: MemorySource | null };
        if (current.content === fields.content) {
          return { kind: "unchanged", row: current };
        }
        const versioned = await insertVersion(client, {
          ...current,
          space_id: meta.space_id ?? fields.spaceId,
          source: meta.source ?? null,
        });
        if (versioned.error) {
          return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
        }
        const updated = await client
          .from("memories")
          .update({ content: fields.content })
          .eq("id", current.id)
          .select(MEMORY_COLUMNS)
          .maybeSingle();
        if (updated.error || !updated.data) {
          return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
        }
        return { kind: "updated", row: asMemory(updated.data as MemoryRecord) };
      }

      const inserted = await client
        .from("memories")
        .insert({
          user_id: userId,
          space_id: fields.spaceId,
          project: fields.project,
          category: fields.category,
          title: fields.title,
          content: fields.content,
          source: fields.source,
        })
        .select(MEMORY_COLUMNS)
        .single();
      if (inserted.error?.code === "23505" || inserted.error || !inserted.data) {
        return { kind: "failed", code: "SAVE_FAILED", message: "Kunde inte spara minnet." };
      }
      return { kind: "created", row: asMemory(inserted.data as MemoryRecord) };
    },

    async setEmbedding(id, embedding) {
      const result = await client.from("memories").update({ embedding }).eq("id", id);
      if (result.error) throw new Error(result.error.message);
    },

    async hasEmbedding(id) {
      const result = await client.from("memories").select("embedding").eq("id", id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      const embedding = (result.data as { embedding?: unknown } | null)?.embedding;
      return Array.isArray(embedding) && embedding.length > 0;
    },

    async listVersions(memoryId) {
      const result = await client
        .from("memory_versions")
        .select(VERSION_COLUMNS)
        .eq("memory_id", memoryId)
        .order("version_number", { ascending: false });
      if (result.error) throw new Error(result.error.message);
      return ((result.data ?? []) as MemoryVersion[]).map(asVersion);
    },

    async spaceOf(memoryId) {
      const result = await client
        .from("memories")
        .select("space_id")
        .eq("id", memoryId)
        .maybeSingle();
      if (result.error || !result.data) return null;
      const spaceId = (result.data as { space_id?: string | null }).space_id;
      return spaceId ?? null;
    },
  };
}
