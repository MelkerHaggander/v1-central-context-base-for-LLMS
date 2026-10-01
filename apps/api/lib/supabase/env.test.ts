import assert from "node:assert/strict";
import { test } from "node:test";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

test("supabase helpers stay empty until env is set", () => {
  assert.equal(getSupabaseUrl(), "");
  assert.equal(getSupabaseAnonKey(), "");
});
