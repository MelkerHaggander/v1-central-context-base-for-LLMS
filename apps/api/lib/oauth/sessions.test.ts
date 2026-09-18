import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asMcpSession, asReusedMcpTokens } from "./session-parse";
import { MCP_NEVER_EXPIRES_AT, mcpClientExpiresIn } from "./sessions";

const row = {
  user_id: "a9625693-0207-4f2b-bf34-f65964eaa346",
  supabase_access: "access",
  supabase_refresh: "refresh",
};

const reused = {
  ...row,
  access_token: "mcp-access",
  refresh_token: "mcp-refresh",
};

test("parses a jsonb session object", () => {
  assert.deepEqual(asMcpSession(row), row);
});

test("parses a jsonb session wrapped in an array or string", () => {
  assert.deepEqual(asMcpSession([row]), row);
  assert.deepEqual(asMcpSession(JSON.stringify(row)), row);
});

test("rejects incomplete session payloads", () => {
  assert.equal(asMcpSession(null), null);
  assert.equal(asMcpSession({ user_id: row.user_id }), null);
  assert.equal(asMcpSession("not-json"), null);
});

test("reuses the same MCP access and refresh tokens", () => {
  assert.deepEqual(asReusedMcpTokens(reused), reused);
  assert.deepEqual(asReusedMcpTokens([reused]), reused);
  assert.deepEqual(asReusedMcpTokens(JSON.stringify(reused)), reused);
  assert.deepEqual(asReusedMcpTokens({ oauth_reuse_session: reused }), reused);
});

test("MCP token response expires_in does not overflow signed 32-bit unix time", () => {
  const now = 1_789_547_000;
  const expiresIn = mcpClientExpiresIn(now);
  assert.equal(expiresIn, 2_147_483_647 - now - 86_400);
  assert.ok(now + expiresIn < 2_147_483_647);
  assert.ok(expiresIn > 300_000_000);
  assert.equal(MCP_NEVER_EXPIRES_AT, "9999-12-31T00:00:00.000Z");
});

test("session RPCs use the service_role client, not the public anon key", () => {
  const src = readFileSync(new URL("./sessions.ts", import.meta.url), "utf8");
  assert.match(src, /createSupabaseAdminClient\(\);\n  const \{ error \} = await supabase\.rpc\("oauth_create_session"/);
  assert.match(src, /createSupabaseAdminClient\(\);\n  const \{ data, error \} = await supabase\.rpc\("oauth_get_session"/);
  assert.match(src, /createSupabaseAdminClient\(\);\n  await supabase\.rpc\("oauth_update_supabase_tokens_for_user"/);
  assert.match(src, /createSupabaseAdminClient\(\);\n    const \{ data, error \} = await supabase\.rpc\("oauth_reuse_session"/);
  assert.doesNotMatch(src, /createSupabaseAnonClient\(\);[\s\S]{0,120}rpc\("oauth_/);
});

test("password login updates MCP tokens with service_role", () => {
  const src = readFileSync(new URL("../../app/api/auth/login/route.ts", import.meta.url), "utf8");
  assert.match(src, /createSupabaseAdminClient\(\)\.rpc\("oauth_update_supabase_tokens_for_user"/);
  assert.doesNotMatch(src, /createSupabaseAnonClient/);
});
