import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  grokNeedsConnectOAuth,
  hasBearerToken,
  isOAuthFirstClient,
  isToolsCallBody,
  mcpCorsPreflightResponse,
  mcpUnauthorizedResponse,
  shouldChallengeMcpOAuth,
} from "../lib/mcp-oauth-challenge";

const MCP = "https://mcp.example.test/api/mcp";

function req(init?: RequestInit & { url?: string }) {
  const { url = MCP, ...rest } = init ?? {};
  return new Request(url, rest);
}

function grokInitialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "Grok" } },
  };
}

function chatgptInitialize() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "chatgpt" } },
  };
}

describe("Grok MCP OAuth challenge", () => {
  it("detects Grok from User-Agent, Origin and initialize clientInfo", () => {
    assert.equal(grokNeedsConnectOAuth(req({ headers: { "user-agent": "GrokBot/1.0" } })), true);
    assert.equal(grokNeedsConnectOAuth(req({ headers: { origin: "https://grok.com" } })), true);
    assert.equal(grokNeedsConnectOAuth(req(), grokInitialize()), true);
    assert.equal(
      grokNeedsConnectOAuth(req({ headers: { "user-agent": "ChatGPT" } }), chatgptInitialize()),
      false,
    );
  });

  it("returns HTTP 401 with absolute resource_metadata so Grok starts login", async () => {
    const res = mcpUnauthorizedResponse(
      req({
        headers: {
          host: "mcp.example.test",
          "x-forwarded-host": "mcp.example.test",
          "x-forwarded-proto": "https",
        },
      }),
    );
    assert.equal(res.status, 401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    assert.match(
      challenge,
      /resource_metadata="https:\/\/mcp\.example\.test\/.well-known\/oauth-protected-resource\/api\/mcp"/,
    );
    assert.match(challenge, /error="invalid_token"/);
    assert.match(challenge, /scope="memory"/);
    assert.equal(res.headers.get("Access-Control-Expose-Headers"), "WWW-Authenticate, MCP-Session-Id");
  });

  it("exposes CORS preflight so grok.com can read the challenge", () => {
    const res = mcpCorsPreflightResponse();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.match(res.headers.get("Access-Control-Allow-Headers") ?? "", /Authorization/);
    assert.match(res.headers.get("Access-Control-Expose-Headers") ?? "", /WWW-Authenticate/);
  });

  it("challenges Grok connect and unauthenticated tools/call, but not ChatGPT handshake", () => {
    assert.equal(shouldChallengeMcpOAuth(req({ method: "GET" })), true);
    assert.equal(shouldChallengeMcpOAuth(req({ method: "POST" }), grokInitialize()), true);
    assert.equal(
      shouldChallengeMcpOAuth(req({ method: "POST", headers: { "user-agent": "GrokBot/1.0" } }), {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
      true,
    );
    assert.equal(shouldChallengeMcpOAuth(req({ method: "POST" }), chatgptInitialize()), false);
    assert.equal(isOAuthFirstClient(req(), grokInitialize()), true);
    assert.equal(isOAuthFirstClient(req({ headers: { "user-agent": "ChatGPT-User" } }), chatgptInitialize()), false);
    assert.equal(
      shouldChallengeMcpOAuth(
        req({ method: "POST", headers: { "user-agent": "ChatGPT-User" } }),
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ),
      false,
    );
    assert.equal(
      shouldChallengeMcpOAuth(req({ method: "POST" }), {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
      false,
    );
    assert.equal(
      shouldChallengeMcpOAuth(req({ method: "POST" }), {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "claude-ai" } },
      }),
      true,
    );
    assert.equal(
      shouldChallengeMcpOAuth(
        req({ method: "POST", headers: { "user-agent": "ChatGPT-User" } }),
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_context" } },
      ),
      false,
    );
    assert.equal(
      shouldChallengeMcpOAuth(req({ method: "POST" }), {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_context" },
      }),
      true,
    );
    assert.equal(
      shouldChallengeMcpOAuth(
        req({ method: "POST", headers: { authorization: "Bearer tok" } }),
        grokInitialize(),
      ),
      false,
    );
  });

  it("treats tools/call without Bearer as a call that must 401", () => {
    assert.equal(hasBearerToken(req()), false);
    assert.equal(hasBearerToken(req({ headers: { authorization: "Bearer tok" } })), true);
    assert.equal(
      isToolsCallBody({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_context" } }),
      true,
    );
    assert.equal(isToolsCallBody({ jsonrpc: "2.0", id: 2, method: "tools/list" }), false);
  });
});
