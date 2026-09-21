import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  join(
    __dirname,
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
