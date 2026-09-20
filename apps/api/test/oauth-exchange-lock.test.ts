import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createSupabaseAdminClient } from "../lib/supabase/clients";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20260920180000_oauth_exchange_code_pkce.sql", import.meta.url),
  "utf8",
);
const tokenRoute = readFileSync(new URL("../app/oauth/token/route.ts", import.meta.url), "utf8");
const approveRoute = readFileSync(new URL("../app/oauth/approve/route.ts", import.meta.url), "utf8");
const authorizePage = readFileSync(new URL("../app/oauth/authorize/page.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../lib/oauth/store.ts", import.meta.url), "utf8");

describe("oauth_exchange_code lock", () => {
  it("drops the public consume RPC and grants the new one only to service_role", () => {
    assert.match(migration, /drop function if exists public\.oauth_consume_code\(text\)/);
    assert.match(migration, /revoke all on function public\.oauth_consume_code\(text\) from public, anon, authenticated, service_role/);
    assert.match(
      migration,
      /revoke all on function public\.oauth_exchange_code\(text, text, text, text\) from public, anon, authenticated, service_role/,
    );
    assert.match(
      migration,
      /grant execute on function public\.oauth_exchange_code\(text, text, text, text\) to service_role/,
    );
    assert.doesNotMatch(migration, /grant execute on function public\.oauth_exchange_code[\s\S]*to anon/);
    assert.doesNotMatch(migration, /grant execute on function public\.oauth_exchange_code[\s\S]*to authenticated/);
    assert.doesNotMatch(migration, /grant execute on function public\.oauth_consume_code/);
  });

  it("matches code, client, redirect, PKCE and expiry in one DELETE", () => {
    const deleteBlock = migration.slice(migration.indexOf("delete from private.oauth_codes"));
    assert.match(deleteBlock, /c\.code = p_code/);
    assert.match(deleteBlock, /c\.client_id = p_client_id/);
    assert.match(deleteBlock, /c\.redirect_uri = p_redirect_uri/);
    assert.match(deleteBlock, /c\.code_challenge = p_code_challenge/);
    assert.match(deleteBlock, /c\.expires_at > pg_catalog\.now\(\)/);
    assert.doesNotMatch(deleteBlock, /select \* from private\.oauth_codes/);
    assert.match(migration, /set search_path = ''/);
    assert.match(migration, /returning c\.user_id, c\.access_token, c\.refresh_token/);
    assert.doesNotMatch(migration, /returning c\.code, c\.client_id/);
  });

  it("does not expose supabase tokens through a public consume RPC", () => {
    assert.doesNotMatch(store, /oauth_consume_code/);
    assert.doesNotMatch(store, /createSupabaseAnonClient\(\);\n  const \{ data, error \} = await supabase\.rpc\("oauth_exchange_code"/);
    assert.match(store, /createSupabaseAdminClient\(\)/);
    assert.match(store, /client\.rpc\("oauth_exchange_code"/);
    assert.doesNotMatch(tokenRoute, /oauth_consume_code|consumeCode|pkceChallenge\(verifier\) !== row/);
  });

  it("keeps the same Connect user flow for current clients", () => {
    assert.match(authorizePage, /OAuthApproveView/);
    assert.match(authorizePage, /action="\/oauth\/approve"/);
    assert.match(approveRoute, /await saveCode\(/);
    assert.match(approveRoute, /next\.searchParams\.set\("code", code\)/);
    assert.match(approveRoute, /Response\.redirect\(next, 302\)/);
    assert.match(tokenRoute, /token_type: "Bearer"/);
    assert.match(tokenRoute, /scope: "memory"/);
    assert.match(tokenRoute, /Access-Control-Allow-Origin": "\*"/);
    assert.match(tokenRoute, /Access-Control-Allow-Methods": "POST, OPTIONS"/);
    assert.match(tokenRoute, /MCP-Protocol-Version/);
    assert.match(tokenRoute, /grant === "refresh_token"/);
  });

  it("does not log codes, verifiers or tokens on token failure", () => {
    assert.match(tokenRoute, /console\.error\(misconfigured \? "oauth_token_misconfigured" : "oauth_token_failed"\)/);
    assert.doesNotMatch(tokenRoute, /console\.error\([^\n]*params/);
    assert.doesNotMatch(tokenRoute, /console\.error\("oauth_token_failed", error\)/);
    assert.doesNotMatch(tokenRoute, /NEXT_PUBLIC_.*SERVICE_ROLE/);
  });

  it("stops without a service role key", () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      assert.throws(() => createSupabaseAdminClient(), /Missing SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      if (previous !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
    }
  });
});
