import assert from "node:assert/strict";
import { test } from "node:test";
import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

test("supabase helpers stay empty until env is set", () => {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    assert.equal(getSupabaseUrl(), "");
    assert.equal(getSupabaseAnonKey(), "");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://your-project.supabase.co/";
    assert.equal(getSupabaseUrl(), "https://your-project.supabase.co");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
