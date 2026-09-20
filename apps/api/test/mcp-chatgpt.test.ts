import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHATGPT_OAUTH_SCHEMES,
  injectToolSecuritySchemes,
  memoryAuthRequiredResult,
  mcpWwwAuthenticate,
  withChatGptToolList,
} from "../lib/mcp-chatgpt";

describe("ChatGPT mixed-auth metadata", () => {
  it("injects oauth2 securitySchemes on tools/list", () => {
    const injected = injectToolSecuritySchemes({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "get_context", description: "hämta kontext" }],
      },
    }) as { result: { tools: Array<{ name: string; securitySchemes: unknown }> } };
    assert.equal(injected.result.tools[0].name, "get_context");
    assert.deepEqual(injected.result.tools[0].securitySchemes, CHATGPT_OAUTH_SCHEMES);
  });

  it("leaves non-list JSON-RPC messages alone", () => {
    const ping = { jsonrpc: "2.0", id: 2, result: {} };
    assert.deepEqual(injectToolSecuritySchemes(ping), ping);
  });

  it("rewrites JSON tools/list HTTP responses", async () => {
    const res = await withChatGptToolList(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [{ name: "save_memory" }] },
      }),
    );
    const body = (await res.json()) as { result: { tools: Array<{ securitySchemes: unknown }> } };
    assert.deepEqual(body.result.tools[0].securitySchemes, CHATGPT_OAUTH_SCHEMES);
  });

  it("puts error + error_description in the MCP auth challenge", () => {
    const challenge = mcpWwwAuthenticate("https://mcp.example.test");
    assert.match(challenge, /resource_metadata="https:\/\/mcp\.example\.test\/.well-known\/oauth-protected-resource\/api\/mcp"/);
    assert.match(challenge, /error="invalid_token"/);
    assert.match(challenge, /error_description=/);
    const result = memoryAuthRequiredResult("https://mcp.example.test");
    assert.equal(result.isError, true);
    assert.deepEqual(result._meta["mcp/www_authenticate"], [challenge]);
  });
});
