import { createHash, randomUUID } from "node:crypto";
import type { MemoryRecord } from "./types";
import type { MemoryStore, NormalizedMemoryInput } from "./store";
import { toIso } from "./time";

type StoredRow = MemoryRecord & { user_id: string };

export type InMemoryStoreOptions = {
  now?: () => Date;
  id?: () => string;
};

export function contentFingerprint(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

function asClient(row: StoredRow): MemoryRecord {
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

function sameIdentity(row: StoredRow, userId: string, fields: NormalizedMemoryInput): boolean {
  return (
    row.user_id === userId &&
    row.project === fields.project &&
    row.category === fields.category &&
    row.title === fields.title &&
    contentFingerprint(row.content) === contentFingerprint(fields.content)
  );
}

export function createInMemoryStore(options: InMemoryStoreOptions = {}): MemoryStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? (() => randomUUID());
  const rows: StoredRow[] = [];

  return {
    async insert(userId, fields) {
      if (rows.some((row) => sameIdentity(row, userId, fields))) {
        return { kind: "duplicate" };
      }
      const timestamp = toIso(now());
      const row: StoredRow = {
        id: id(),
        user_id: userId,
        project: fields.project,
        category: fields.category as MemoryRecord["category"],
        title: fields.title,
        content: fields.content,
        created_at: timestamp,
        updated_at: timestamp,
      };
      rows.push(row);
      return { kind: "created", row: asClient(row) };
    },

    async findIdentical(userId, fields) {
      const row = rows.find((candidate) => sameIdentity(candidate, userId, fields));
      return row ? asClient(row) : null;
    },

    async update(userId, memoryId, fields) {
      const row = rows.find((candidate) => candidate.id === memoryId && candidate.user_id === userId);
      if (!row) return { kind: "missing" };
      if (
        rows.some(
          (candidate) => candidate.id !== memoryId && sameIdentity(candidate, userId, fields),
        )
      ) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      row.project = fields.project;
      row.category = fields.category as MemoryRecord["category"];
      row.title = fields.title;
      row.content = fields.content;
      row.updated_at = toIso(now());
      return { kind: "updated", row: asClient(row) };
    },

    async remove(userId, memoryId) {
      const index = rows.findIndex(
        (candidate) => candidate.id === memoryId && candidate.user_id === userId,
      );
      if (index < 0) return { kind: "missing" };
      rows.splice(index, 1);
      return { kind: "deleted" };
    },

    async listByUser(userId) {
      return rows.filter((row) => row.user_id === userId).map(asClient);
    },
  };
}
