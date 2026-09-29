import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseStore, vectorLiteral } from "../src/supabase";
import { saveDashboardMemory } from "../src/store";
import type { SpaceAccess } from "../src/types";

const USER = "user-a";
const SPACE = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-09-29T10:25:00Z";

type MemoryRow = {
  id: string;
  user_id: string;
  space_id: string;
  project: string;
  category: string;
  title: string;
  content: string;
  source: string | null;
  embedding: string | null;
  created_at: string;
  updated_at: string;
};

type VersionRow = {
  memory_id: string;
  space_id: string | null;
  changed_by: string;
  event: string;
  project: string;
  category: string;
  title_before: string;
  title_after: string;
  content_before: string;
  content_after: string;
  source: string | null;
  version_number: number;
};

type Filter = { column: string; op: "eq" | "in"; value: unknown };

function createCastingClient() {
  const memories: MemoryRow[] = [];
  const versions: VersionRow[] = [];
  let next = 1;

  function query(table: "memories" | "memory_versions") {
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> | null = null;
    const filters: Filter[] = [];

    const builder = {
      insert(fields: Record<string, unknown>) {
        op = "insert";
        payload = fields;
        return builder;
      },
      update(fields: Record<string, unknown>) {
        op = "update";
        payload = fields;
        return builder;
      },
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ column, op: "eq", value });
        return builder;
      },
      in(column: string, value: unknown) {
        filters.push({ column, op: "in", value });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(run("maybe"));
      },
      single() {
        return Promise.resolve(run("single"));
      },
      then(
        onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => unknown) | null,
        onrejected?: ((reason: unknown) => unknown) | null,
      ) {
        return Promise.resolve(run("many")).then(onfulfilled, onrejected);
      },
    };

    function matches(row: Record<string, unknown>) {
      return filters.every((filter) => {
        if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.column]);
        return row[filter.column] === filter.value;
      });
    }

    function run(mode: "maybe" | "single" | "many") {
      if (table === "memory_versions") return runVersions(mode);
      return runMemories(mode);
    }

    function runVersions(mode: "maybe" | "single" | "many") {
      if (op === "insert") {
        const fields = payload ?? {};
        versions.push({
          memory_id: String(fields.memory_id),
          space_id: (fields.space_id as string | null) ?? null,
          changed_by: String(fields.changed_by),
          event: String(fields.event),
          project: String(fields.project),
          category: String(fields.category),
          title_before: String(fields.title_before),
          title_after: String(fields.title_after),
          content_before: String(fields.content_before),
          content_after: String(fields.content_after),
          source: (fields.source as string | null) ?? null,
          version_number: Number(fields.version_number),
        });
        return { data: null, error: null };
      }
      const rows = versions.filter((row) => matches(row as unknown as Record<string, unknown>));
      if (mode === "many") return { data: rows, error: null };
      return { data: rows[0] ?? null, error: null };
    }

    function runMemories(mode: "maybe" | "single" | "many") {
      if (op === "insert") {
        const fields = payload ?? {};
        const row: MemoryRow = {
          id: `mem-${next++}`,
          user_id: String(fields.user_id),
          space_id: String(fields.space_id),
          project: String(fields.project),
          category: String(fields.category),
          title: String(fields.title),
          content: String(fields.content),
          source: (fields.source as string | null) ?? null,
          embedding: null,
          created_at: NOW,
          updated_at: NOW,
        };
        memories.push(row);
        return { data: row, error: null };
      }

      const rows = memories.filter((row) => matches(row as unknown as Record<string, unknown>));
      if (op === "update") {
        const fields = payload ?? {};
        if ("embedding" in fields && Array.isArray(fields.embedding)) {
          return { data: null, error: { message: "cannot cast jsonb to vector" } };
        }
        if (rows.length === 0) return { data: mode === "many" ? [] : null, error: null };
        for (const row of rows) {
          if (typeof fields.content === "string") row.content = fields.content;
          if (typeof fields.embedding === "string") row.embedding = fields.embedding;
          row.updated_at = NOW;
        }
        if (mode === "many") return { data: rows.map((row) => ({ id: row.id })), error: null };
        return { data: rows[0], error: null };
      }

      if (mode === "many") return { data: rows, error: null };
      if (mode === "maybe" && rows.length > 1) {
        return { data: null, error: { message: "multiple rows" } };
      }
      return { data: rows[0] ?? null, error: null };
    }

    return builder;
  }

  return {
    memories,
    versions,
    from(table: string) {
      if (table !== "memories" && table !== "memory_versions") {
        throw new Error(`unexpected table ${table}`);
      }
      return query(table);
    },
  };
}

const spaces: SpaceAccess = {
  async readableSpaceIds() {
    return [SPACE];
  },
  async spaceFor() {
    return SPACE;
  },
  async isMember() {
    return true;
  },
};

test("vectorLiteral is the pgvector text form, not a JSON array", () => {
  assert.equal(vectorLiteral([1, 0, 0.5]), "[1,0,0.5]");
});

test("dashboard save stores the embedding and keeps the old text only in history", async () => {
  const client = createCastingClient();
  const store = createSupabaseStore(client);
  const embedding = {
    dimensions: 3,
    async embed() {
      return [1, 0, 0];
    },
  };
  const brain = { spaces, embedding };

  const created = await saveDashboardMemory(
    USER,
    {
      project: "Projekt A",
      category: "fact",
      title: "Alfredo v1.2 personal",
      content: "Dashboard personal works",
    },
    SPACE,
    store,
    brain,
  );
  assert.ok("data" in created);

  const updated = await saveDashboardMemory(
    USER,
    {
      project: "Projekt A",
      category: "fact",
      title: "Alfredo v1.2 personal",
      content: "Dashboard personal updated",
    },
    SPACE,
    store,
    brain,
  );
  assert.ok("data" in updated);
  assert.equal(updated.data.id, created.data.id);

  const live = client.memories.filter((row) => row.title === "Alfredo v1.2 personal");
  assert.equal(live.length, 1);
  assert.equal(live[0]?.content, "Dashboard personal updated");
  assert.equal(live[0]?.embedding, "[1,0,0]");
  assert.equal(
    live.some((row) => row.content === "Dashboard personal works"),
    false,
  );

  const history = client.versions.filter((row) => row.memory_id === created.data.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.content_before, "Dashboard personal works");
  assert.equal(history[0]?.content_after, "Dashboard personal updated");
  assert.equal(history[0]?.event, "update");
});
