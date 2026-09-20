import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizationCodeGrant } from "./authorization-code";
import { pkceChallenge } from "./crypto";
import { exchangeAuthorizationCode, type OauthAdminRpc } from "./store";

const USER = "a9625693-0207-4f2b-bf34-f65964eaa346";
const VERIFIER = "test-verifier-value";
const CHALLENGE = pkceChallenge(VERIFIER);
const NOW = new Date("2026-09-20T16:00:00.000Z");

type CodeRow = {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  access_token: string;
  refresh_token: string | null;
  user_id: string;
  expires_at: Date;
};

function sampleRow(overrides: Partial<CodeRow> = {}): CodeRow {
  return {
    code: "auth-code-1",
    client_id: "client-1",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_challenge: CHALLENGE,
    access_token: "sb-access",
    refresh_token: "sb-refresh",
    user_id: USER,
    expires_at: new Date("2026-09-20T16:10:00.000Z"),
    ...overrides,
  };
}

/** Mirrors public.oauth_exchange_code: match in the same DELETE, miss leaves the row. */
function fakeExchange(rows: CodeRow[], now = NOW): OauthAdminRpc {
  return {
    async rpc(fn, args) {
      assert.equal(fn, "oauth_exchange_code");
      assert.equal("p_code" in args && "p_client_id" in args && "p_redirect_uri" in args && "p_code_challenge" in args, true);
      const code = String(args.p_code ?? "");
      const clientId = String(args.p_client_id ?? "");
      const redirectUri = String(args.p_redirect_uri ?? "");
      const challenge = String(args.p_code_challenge ?? "");
      if (!code || !clientId || !redirectUri || !challenge) return { data: [], error: null };
      const index = rows.findIndex(
        (row) =>
          row.code === code &&
          row.client_id === clientId &&
          row.redirect_uri === redirectUri &&
          row.code_challenge === challenge &&
          row.expires_at.getTime() > now.getTime() &&
          Boolean(row.refresh_token),
      );
      if (index === -1) return { data: [], error: null };
      const [hit] = rows.splice(index, 1);
      return {
        data: [
          {
            user_id: hit.user_id,
            access_token: hit.access_token,
            refresh_token: hit.refresh_token,
          },
        ],
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
    exchangeAuthorizationCode: (input) => exchangeAuthorizationCode(input, fakeExchange(rows)),
    issueMcpTokens: async () => ({
      access_token: "mcp-access",
      refresh_token: "mcp-refresh",
      expires_in: 3600,
      supabase_access: "sb-access",
    }),
    pkceChallenge,
  });
}

describe("authorization code exchange", () => {
  it("returns tokens for a matching code and verifier", async () => {
    const rows = [sampleRow()];
    const result = await grantWith(rows);
    assert.equal("issued" in result, true);
    if ("issued" in result) {
      assert.equal(result.issued.access_token, "mcp-access");
      assert.equal(result.issued.refresh_token, "mcp-refresh");
      assert.equal(result.issued.expires_in, 3600);
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

  it("does not return supabase tokens through the public RPC shape", async () => {
    const rows = [sampleRow()];
    const exchanged = await exchangeAuthorizationCode(
      {
        code: "auth-code-1",
        clientId: "client-1",
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        codeChallenge: CHALLENGE,
      },
      fakeExchange(rows),
    );
    assert.deepEqual(exchanged, {
      userId: USER,
      supabaseAccess: "sb-access",
      supabaseRefresh: "sb-refresh",
    });
    assert.equal("code_challenge" in (exchanged as object), false);
  });
});
