import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizationCodeGrant } from "./authorization-code";
import { pkceChallenge } from "./crypto";
import { releaseMcpTokens, type OauthRpc } from "./store";

const VERIFIER = "test-verifier-value";
const CHALLENGE = pkceChallenge(VERIFIER);
const NOW = new Date("2026-09-20T16:00:00.000Z");

type CodeRow = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  mcp_access_token: string | null;
  mcp_refresh_token: string | null;
  expires_at: Date;
};

function sampleRow(overrides: Partial<CodeRow> = {}): CodeRow {
  return {
    code: "auth-code-1",
    client_id: "client-1",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: CHALLENGE,
    mcp_access_token: "mcp-access",
    mcp_refresh_token: "mcp-refresh",
    expires_at: new Date("2026-09-20T16:10:00.000Z"),
    ...overrides,
  };
}

/** Mirrors oauth_release_mcp_tokens: hash the verifier, miss leaves the row. */
function fakeRelease(rows: CodeRow[], now = NOW): OauthRpc {
  return {
    async rpc(fn, args) {
      assert.equal(fn, "oauth_release_mcp_tokens");
      assert.equal("p_code_challenge" in args, false);
      const code = String(args.p_code ?? "");
      const clientId = String(args.p_client_id ?? "");
      const redirectUri = String(args.p_redirect_uri ?? "");
      const verifier = String(args.p_code_verifier ?? "");
      if (!code || !clientId || !redirectUri || !verifier) return { data: [], error: null };
      const challenge = pkceChallenge(verifier);
      const index = rows.findIndex(
        (row) =>
          row.code === code &&
          row.client_id === clientId &&
          row.redirect_uri === redirectUri &&
          row.code_challenge === challenge &&
          row.expires_at.getTime() > now.getTime() &&
          Boolean(row.mcp_access_token) &&
          Boolean(row.mcp_refresh_token),
      );
      if (index === -1) return { data: [], error: null };
      const [hit] = rows.splice(index, 1);
      return {
        data: [{ access_token: hit.mcp_access_token, refresh_token: hit.mcp_refresh_token }],
        error: null,
      };
    },
  };
}

const grantParams = {
  code: "auth-code-1",
  client_id: "client-1",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_verifier: VERIFIER,
};

async function grantWith(rows: CodeRow[], params: Record<string, string> = grantParams) {
  return authorizationCodeGrant(params, {
    releaseMcpTokens: (input) => releaseMcpTokens(input, fakeRelease(rows)),
    expiresIn: () => 3600,
  });
}

describe("authorization code exchange", () => {
  it("returns the MCP tokens saved at approval when the verifier matches", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows);
    assert.equal("issued" in result, true);
    if ("issued" in result) {
      assert.equal(result.issued.access_token, "mcp-access");
      assert.equal(result.issued.refresh_token, "mcp-refresh");
      assert.equal(result.issued.expires_in, 3600);
      assert.equal(result.issued.supabase_access, "");
    }
    assert.equal(rows.length, 0);
  });

  it("returns invalid_grant for the wrong verifier and keeps the code", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows, { ...grantParams, code_verifier: "other-verifier" });
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });

  it("returns invalid_grant for the wrong client_id and keeps the code", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows, { ...grantParams, client_id: "other-client" });
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });

  it("returns invalid_grant for the wrong redirect_uri and keeps the code", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows, {
      ...grantParams,
      redirect_uri: "https://evil.example/callback",
    });
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });

  it("returns invalid_grant for an expired code and keeps the row", async () => {
    const rows = [sampleRow({ expires_at: new Date("2026-09-20T15:59:00.000Z") })];
    const result = await grantWith(rows);
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });

  it("returns invalid_grant when required PKCE fields are missing", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows, { ...grantParams, code_verifier: "" });
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });

  it("allows a code to be used only once", async () => {
    const rows = [sampleRow()];
    const first = await grantWith(rows);
    const second = await grantWith(rows);
    assert.equal("issued" in first, true);
    assert.deepEqual(second, { error: "invalid_grant" });
  });

  it("does not consume a valid code after a failed attempt", async () => {
    const rows = [sampleRow()];
    const failed = await grantWith(rows, { ...grantParams, code_verifier: "wrong" });
    const ok = await grantWith(rows);
    assert.deepEqual(failed, { error: "invalid_grant" });
    assert.equal("issued" in ok, true);
    assert.equal(rows.length, 0);
  });

  it("does not release a row that has no MCP tokens", async () => {
    const rows = [sampleRow({ mcp_access_token: null, mcp_refresh_token: null })];
    const result = await grantWith(rows);
    assert.deepEqual(result, { error: "invalid_grant" });
    assert.equal(rows.length, 1);
  });
});
