import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentFingerprint } from "../src/in-memory";
import type { MemoryRecord } from "../src/types";

export type FakeStoredRow = MemoryRecord & { user_id: string };

export type FakeSupabaseOptions = {
  userId: string;
  now?: () => Date;
  id?: () => string;
  rows?: FakeStoredRow[];
  failSelect?: boolean;
  failInsert?: boolean;
  failUpdate?: boolean;
  failDelete?: boolean;
};

type Filter = { column: string; value: unknown };

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

type FakeContext = {
  userId: string;
  now: () => Date;
  id: () => string;
  rows: FakeStoredRow[];
  failSelect: boolean;
  failInsert: boolean;
  failUpdate: boolean;
  failDelete: boolean;
};

function clientColumns(row: FakeStoredRow): MemoryRecord {
  return {
    id: row.id,
    project: row.project,
    category: row.category,
    title: row.title,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function identityKey(userId: string, fields: {
  project: string;
  category: string;
  title: string;
  content: string;
}): string {
  return [
    userId,
    fields.project,
    fields.category,
    fields.title,
    contentFingerprint(fields.content),
  ].join("\0");
}

function matchesFilters(row: FakeStoredRow, filters: Filter[]): boolean {
  return filters.every((filter) => row[filter.column as keyof FakeStoredRow] === filter.value);
}

class MemoriesQuery {
  #op: "select" | "insert" | "update" | "delete" = "select";
  #payload: Record<string, unknown> | null = null;
  #filters: Filter[] = [];
  #result: Promise<QueryResult> | undefined;

  constructor(private readonly ctx: FakeContext) {}

  insert(fields: Record<string, unknown>) {
    this.#op = "insert";
    this.#payload = fields;
    return this;
  }

  update(fields: Record<string, unknown>) {
    this.#op = "update";
    this.#payload = fields;
    return this;
  }

  delete() {
    this.#op = "delete";
    return this;
  }

  select(_columns: string) {
    return this;
  }

  eq(column: string, value: unknown) {
    this.#filters.push({ column, value });
    return this;
  }

  single() {
    return this.#run("single");
  }

  maybeSingle() {
    return this.#run("maybe");
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.#run("many").then(onfulfilled, onrejected);
  }

  #run(mode: "single" | "maybe" | "many") {
    this.#result ??= Promise.resolve(this.#execute(mode));
    return this.#result;
  }

  #visible(): FakeStoredRow[] {
    return this.ctx.rows.filter((row) => row.user_id === this.ctx.userId);
  }

  #execute(mode: "single" | "maybe" | "many"): QueryResult {
    if (this.#op === "insert") return this.#insert();
    if (this.#op === "update") return this.#update(mode);
    if (this.#op === "delete") return this.#delete(mode);
    return this.#select(mode);
  }

  #insert(): QueryResult {
    if (this.ctx.failInsert) {
      return { data: null, error: { code: "XX000", message: "insert failed" } };
    }

    const fields = this.#payload ?? {};
    const project = String(fields.project ?? "");
    const category = String(fields.category ?? "");
    const title = String(fields.title ?? "");
    const content = String(fields.content ?? "");
    const key = identityKey(this.ctx.userId, { project, category, title, content });

    if (this.ctx.rows.some((row) => identityKey(row.user_id, row) === key)) {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      };
    }

    const timestamp = this.ctx.now().toISOString();
    const row: FakeStoredRow = {
      id: this.ctx.id(),
      user_id: this.ctx.userId,
      project,
      category: category as MemoryRecord["category"],
      title,
      content,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.ctx.rows.push(row);
    return { data: clientColumns(row), error: null };
  }

  #update(mode: "single" | "maybe" | "many"): QueryResult {
    if (this.ctx.failUpdate) {
      return { data: null, error: { code: "XX000", message: "update failed" } };
    }

    const matches = this.#visible().filter((row) => matchesFilters(row, this.#filters));
    if (matches.length === 0) {
      return { data: mode === "single" ? null : null, error: mode === "single" ? { code: "PGRST116", message: "0 rows" } : null };
    }

    const row = matches[0];
    if (!row) {
      return { data: null, error: null };
    }

    const fields = this.#payload ?? {};
    const next = {
      project: String(fields.project ?? row.project),
      category: String(fields.category ?? row.category),
      title: String(fields.title ?? row.title),
      content: String(fields.content ?? row.content),
    };
    const key = identityKey(this.ctx.userId, next);
    if (this.ctx.rows.some((candidate) => candidate.id !== row.id && identityKey(candidate.user_id, candidate) === key)) {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      };
    }

    row.project = next.project;
    row.category = next.category as MemoryRecord["category"];
    row.title = next.title;
    row.content = next.content;
    row.updated_at = this.ctx.now().toISOString();
    return { data: clientColumns(row), error: null };
  }

  #delete(mode: "single" | "maybe" | "many"): QueryResult {
    if (this.ctx.failDelete) {
      return { data: null, error: { code: "XX000", message: "delete failed" } };
    }

    const matches = this.#visible().filter((row) => matchesFilters(row, this.#filters));
    if (matches.length === 0) {
      return {
        data: null,
        error: mode === "single" ? { code: "PGRST116", message: "0 rows" } : null,
      };
    }

    const row = matches[0];
    if (!row) {
      return { data: null, error: null };
    }

    const index = this.ctx.rows.indexOf(row);
    if (index >= 0) this.ctx.rows.splice(index, 1);
    return { data: clientColumns(row), error: null };
  }

  #select(mode: "single" | "maybe" | "many"): QueryResult {
    if (this.ctx.failSelect) {
      return { data: null, error: { code: "XX000", message: "select failed" } };
    }

    const data = this.#visible().filter((row) => matchesFilters(row, this.#filters)).map(clientColumns);
    if (mode === "single") {
      if (data.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: `${data.length} rows` } };
      }
      return { data: data[0], error: null };
    }
    if (mode === "maybe") {
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }
}

export function createFakeSupabase(options: FakeSupabaseOptions): { from: SupabaseClient["from"] } {
  const ctx: FakeContext = {
    userId: options.userId,
    now: options.now ?? (() => new Date()),
    id: options.id ?? (() => randomUUID()),
    rows: options.rows ?? [],
    failSelect: options.failSelect ?? false,
    failInsert: options.failInsert ?? false,
    failUpdate: options.failUpdate ?? false,
    failDelete: options.failDelete ?? false,
  };

  return {
    from: ((table: string) => {
      if (table !== "memories") {
        throw new Error(`fake supabase only implements memories, got ${table}`);
      }
      return new MemoriesQuery(ctx);
    }) as SupabaseClient["from"],
  };
}
