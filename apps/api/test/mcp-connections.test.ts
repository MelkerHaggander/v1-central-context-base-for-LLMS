import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { asMcpConnections } from "../lib/oauth/mcp-connections";
import { MCP_NEVER_EXPIRES_AT } from "../lib/oauth/sessions";

const migration = readFileSync(
  new URL("../../../supabase/migrations/20261001120000_mcp_connection_revoke.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(new URL("../app/api/mcp/connections/route.ts", import.meta.url), "utf8");
const sessions = readFileSync(new URL("../lib/oauth/sessions.ts", import.meta.url), "utf8");

const row = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  created_at: "2026-10-01T09:00:00.000Z",
};

describe("MCP connections can be removed without expiring", () => {
  it("reads an id and a time and refuses a payload that carries a token", () => {
    assert.deepEqual(asMcpConnections([row]), [row]);
    assert.deepEqual(asMcpConnections({ oauth_list_my_sessions: [row] }), [row]);
    assert.equal(asMcpConnections([{ ...row, access_token: "secret" }]), null);
    assert.equal(asMcpConnections([{ ...row, refresh_token: "secret" }]), null);
    assert.equal(asMcpConnections([{ ...row, supabase_access: "secret" }]), null);
    assert.equal(asMcpConnections(null), null);
  });

  it("lets only the signed-in person list and delete their own rows", () => {
    assert.match(migration, /where session\.user_id = auth\.uid\(\)/);
    assert.match(migration, /where id = p_id and user_id = auth\.uid\(\)/);
    assert.match(migration, /where user_id = auth\.uid\(\)/);
    assert.match(migration, /jsonb_build_object\('id', session\.id, 'created_at', session\.created_at\)/);
    assert.doesNotMatch(migration, /access_token|refresh_token|supabase_access/);
    assert.doesNotMatch(migration, /function public\.oauth_get_session/);
    assert.match(
      migration,
      /revoke all on function public\.oauth_list_my_sessions\(\) from public, anon, authenticated, service_role/,
    );
    assert.match(migration, /grant execute on function public\.oauth_list_my_sessions\(\) to authenticated;/);
    assert.match(migration, /grant execute on function public\.oauth_revoke_my_session\(uuid\) to authenticated;/);
    assert.match(migration, /grant execute on function public\.oauth_revoke_my_sessions\(\) to authenticated;/);
    assert.doesNotMatch(migration, /grant execute on function public\.oauth_list_my_sessions\(\) to anon/);
    assert.doesNotMatch(migration, /grant execute on function public\.oauth_revoke_my_session\(uuid\) to anon/);
  });

  it("keeps a connection alive until it is removed", () => {
    assert.equal(MCP_NEVER_EXPIRES_AT, "9999-12-31T00:00:00.000Z");
    assert.match(sessions, /MCP_NEVER_EXPIRES_AT/);
    assert.doesNotMatch(route, /createSupabaseAdminClient/);
    assert.match(route, /oauth_list_my_sessions/);
    assert.match(route, /oauth_revoke_my_session/);
    assert.match(route, /oauth_revoke_my_sessions/);
    assert.match(route, /supabase\.auth\.getUser/);
  });
});
