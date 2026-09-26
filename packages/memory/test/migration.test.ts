import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260921200000_merge_memory_identity_duplicates.sql",
  ),
  "utf8",
);

test("identity migration merges per-user duplicates before adding the unique index", () => {
  assert.match(migration, /partition by user_id, project, category, title/i);
  assert.match(migration, /merge into public\.memories/i);
  assert.doesNotMatch(migration, /delete from public\.memories/i);
  assert.match(
    migration,
    /unique index if not exists memories_identity_idx[\s\S]*user_id, project, category, title/i,
  );
});

const brainMigration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260926120000_v12_brain_vectors.sql",
  ),
  "utf8",
);

test("v1.2 brain migration adds vectors, spaces and member RLS without deleting rows", () => {
  assert.match(brainMigration, /Alfredo runs this file/i);
  assert.match(brainMigration, /create extension if not exists vector/i);
  assert.match(brainMigration, /create table if not exists public\.spaces/i);
  assert.match(brainMigration, /create table if not exists public\.space_members/i);
  assert.match(brainMigration, /embedding vector\(3072\)/i);
  assert.match(brainMigration, /source in \('dashboard', 'brain'\)/i);
  assert.match(
    brainMigration,
    /create unique index memories_identity_idx[\s\S]*\(space_id, project, category, title, md5\(content\)\)[\s\S]*where space_id is not null/i,
  );
  assert.match(brainMigration, /create table if not exists public\.memory_versions/i);
  assert.match(brainMigration, /references public\.memories \(id\) on delete cascade/i);
  const versionTable =
    brainMigration.match(/create table if not exists public\.memory_versions \([\s\S]*?\);/i)?.[0] ??
    "";
  assert.doesNotMatch(versionTable, /embedding/i);
  assert.match(brainMigration, /function public\.match_memories/i);
  assert.match(brainMigration, /memory\.space_id = any \(space_ids\)/i);
  assert.match(brainMigration, /from public\.space_members as member/i);
  assert.match(brainMigration, /member\.user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(brainMigration, /delete from/i);
  assert.doesNotMatch(brainMigration, /mcp_insert_memory|auth\.users[\s\S]{0,40}insert into/i);
});
