import { createHash, randomUUID } from "node:crypto";
import type { Category, MemoryRecord, MemorySource, MemoryVersion, SubjectWrite } from "./types";
import type { MemoryIdentity } from "./types";
import type { MemoryStore, NearestHit, NormalizedMemoryInput } from "./store";
import { cosineSimilarity } from "./brain";
import { toIso } from "./time";

type StoredRow = MemoryRecord & {
  user_id: string;
  space_id: string | null;
  source: MemorySource | null;
  embedding: number[] | null;
};

type StoredVersion = MemoryVersion & { memory_id: string };

export type InMemoryStoreOptions = {
  now?: () => Date;
  id?: () => string;
};

export type MemorySnapshot = {
  id: string;
  user_id: string;
  space_id: string | null;
  source: MemorySource | null;
  project: string;
  category: Category;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  embedding: number[] | null;
};

export type InMemoryStore = MemoryStore & {
  snapshot(): MemorySnapshot[];
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

function sameKey(row: StoredRow, userId: string, fields: NormalizedMemoryInput): boolean {
  return (
    row.user_id === userId &&
    row.project === fields.project &&
    row.category === fields.category &&
    row.title === fields.title
  );
}

function sameIdentity(row: StoredRow, userId: string, fields: NormalizedMemoryInput): boolean {
  return (
    sameKey(row, userId, fields) &&
    contentFingerprint(row.content) === contentFingerprint(fields.content)
  );
}

function asVersion(version: StoredVersion): MemoryVersion {
  return {
    version_number: version.version_number,
    space_id: version.space_id,
    project: version.project,
    category: version.category,
    title: version.title,
    content: version.content,
    source: version.source,
    created_at: version.created_at,
  };
}

export function createInMemoryStore(options: InMemoryStoreOptions = {}): InMemoryStore {
  const now = options.now ?? (() => new Date());
  const id = options.id ?? (() => randomUUID());
  const rows: StoredRow[] = [];
  const versions: StoredVersion[] = [];

  function findRow(memoryId: string): StoredRow | undefined {
    return rows.find((candidate) => candidate.id === memoryId);
  }

  function writeVersion(row: StoredRow, timestamp: string) {
    const previous = versions.filter((version) => version.memory_id === row.id);
    versions.push({
      memory_id: row.id,
      version_number: previous.length + 1,
      space_id: row.space_id,
      project: row.project,
      category: row.category,
      title: row.title,
      content: row.content,
      source: row.source,
      created_at: timestamp,
    });
  }

  function subjectRow(fields: SubjectWrite): StoredRow | undefined {
    return rows.find(
      (candidate) =>
        candidate.space_id === fields.spaceId &&
        candidate.project === fields.project &&
        candidate.category === fields.category &&
        candidate.title === fields.title,
    );
  }

  return {
    async insert(userId, fields) {
      if (rows.some((row) => sameKey(row, userId, fields))) {
        return { kind: "duplicate" };
      }
      const timestamp = toIso(now());
      const row: StoredRow = {
        id: id(),
        user_id: userId,
        space_id: null,
        source: null,
        embedding: null,
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
          (candidate) => candidate.id !== memoryId && sameKey(candidate, userId, fields),
        )
      ) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      const unchanged =
        row.project === fields.project &&
        row.category === fields.category &&
        row.title === fields.title &&
        row.content === fields.content;
      if (unchanged) return { kind: "updated", row: asClient(row) };

      const timestamp = toIso(now());
      const textChanged = row.title !== fields.title || row.content !== fields.content;
      if (textChanged) writeVersion(row, timestamp);
      row.project = fields.project;
      row.category = fields.category as MemoryRecord["category"];
      row.title = fields.title;
      row.content = fields.content;
      row.updated_at = timestamp;
      if (textChanged) row.embedding = null;
      return { kind: "updated", row: asClient(row) };
    },

    async updateById(memoryId, fields) {
      const row = findRow(memoryId);
      if (!row) return { kind: "missing" };
      if (
        rows.some(
          (candidate) =>
            candidate.id !== memoryId &&
            candidate.space_id === row.space_id &&
            candidate.project === fields.project &&
            candidate.category === fields.category &&
            candidate.title === fields.title &&
            (row.space_id !== null || candidate.user_id === row.user_id),
        )
      ) {
        return { kind: "failed", code: "UPDATE_FAILED", message: "Kunde inte uppdatera minnet." };
      }
      const unchanged =
        row.project === fields.project &&
        row.category === fields.category &&
        row.title === fields.title &&
        row.content === fields.content;
      if (unchanged) return { kind: "updated", row: asClient(row) };

      const timestamp = toIso(now());
      const textChanged = row.title !== fields.title || row.content !== fields.content;
      if (textChanged) writeVersion(row, timestamp);
      row.project = fields.project;
      row.category = fields.category as MemoryRecord["category"];
      row.title = fields.title;
      row.content = fields.content;
      row.updated_at = timestamp;
      if (textChanged) row.embedding = null;
      return { kind: "updated", row: asClient(row) };
    },

    async remove(userId, memoryId) {
      const index = rows.findIndex(
        (candidate) => candidate.id === memoryId && candidate.user_id === userId,
      );
      if (index < 0) return { kind: "missing" };
      const [removed] = rows.splice(index, 1);
      if (removed) {
        for (let cursor = versions.length - 1; cursor >= 0; cursor -= 1) {
          if (versions[cursor]?.memory_id === removed.id) versions.splice(cursor, 1);
        }
      }
      return { kind: "deleted" };
    },

    async listByUser(userId) {
      return rows.filter((row) => row.user_id === userId).map(asClient);
    },

    async listBySpaces(_userId, spaceIds) {
      const allowed = new Set(spaceIds);
      return rows.filter((row) => row.space_id !== null && allowed.has(row.space_id)).map(asClient);
    },

    async listNearest(_userId, embedding, spaceIds, limit) {
      const allowed = new Set(spaceIds);
      const hits: NearestHit[] = [];
      for (const row of rows) {
        if (!row.space_id || !allowed.has(row.space_id) || !row.embedding) continue;
        hits.push({
          row: asClient(row),
          similarity: cosineSimilarity(embedding, row.embedding),
        });
      }
      hits.sort((a, b) => b.similarity - a.similarity);
      return hits.slice(0, limit);
    },

    async listNeighbors(_userId, seedIds, spaceIds, minSimilarity, limit) {
      const allowed = new Set(spaceIds);
      const seeds = rows.filter((row) => seedIds.includes(row.id) && row.embedding);
      const best = new Map<string, NearestHit>();
      for (const seed of seeds) {
        if (!seed.embedding) continue;
        for (const row of rows) {
          if (row.id === seed.id || !row.space_id || !allowed.has(row.space_id) || !row.embedding) {
            continue;
          }
          const similarity = cosineSimilarity(seed.embedding, row.embedding);
          if (similarity < minSimilarity) continue;
          const current = best.get(row.id);
          if (!current || similarity > current.similarity) {
            best.set(row.id, { row: asClient(row), similarity });
          }
        }
      }
      return [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    },

    async listIdentities(_userId, spaceIds, limit) {
      const allowed = new Set(spaceIds);
      const identities: MemoryIdentity[] = rows
        .filter((row) => row.space_id !== null && allowed.has(row.space_id))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
        .slice(0, limit)
        .map((row) => ({
          project: row.project,
          category: row.category,
          title: row.title,
          updated_at: row.updated_at,
        }));
      return identities;
    },

    async upsertSubject(userId, fields) {
      const existing = subjectRow(fields);
      if (existing) {
        if (existing.content === fields.content) {
          return { kind: "unchanged", row: asClient(existing) };
        }
        const timestamp = toIso(now());
        writeVersion(existing, timestamp);
        existing.content = fields.content;
        existing.updated_at = timestamp;
        existing.embedding = null;
        return { kind: "updated", row: asClient(existing) };
      }

      const timestamp = toIso(now());
      const row: StoredRow = {
        id: id(),
        user_id: userId,
        space_id: fields.spaceId,
        source: fields.source,
        embedding: null,
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

    async setEmbedding(memoryId, embedding) {
      const row = findRow(memoryId);
      if (!row) return;
      row.embedding = embedding;
    },

    async hasEmbedding(memoryId) {
      return Boolean(findRow(memoryId)?.embedding);
    },

    async listVersions(memoryId) {
      if (!findRow(memoryId)) return null;
      return versions
        .filter((version) => version.memory_id === memoryId)
        .sort((a, b) => b.version_number - a.version_number)
        .map(asVersion);
    },

    async spaceOf(memoryId) {
      return findRow(memoryId)?.space_id ?? null;
    },

    async removeById(memoryId) {
      const index = rows.findIndex((candidate) => candidate.id === memoryId);
      if (index < 0) return { kind: "missing" };
      rows.splice(index, 1);
      for (let cursor = versions.length - 1; cursor >= 0; cursor -= 1) {
        if (versions[cursor]?.memory_id === memoryId) versions.splice(cursor, 1);
      }
      return { kind: "deleted" };
    },

    snapshot() {
      return rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        space_id: row.space_id,
        source: row.source,
        project: row.project,
        category: row.category,
        title: row.title,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
        embedding: row.embedding ? [...row.embedding] : null,
      }));
    },
  };
}
