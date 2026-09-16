import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPublicMcpBody,
  isPublicMcpHandshake,
  isPublicMcpMethod,
} from "../lib/mcp-public-handshake";

describe("ChatGPT public MCP handshake", () => {
  it("allows initialize, ping and tools/list", () => {
    assert.equal(isPublicMcpMethod("initialize"), true);
    assert.equal(isPublicMcpMethod("ping"), true);
    assert.equal(isPublicMcpMethod("tools/list"), true);
    assert.equal(isPublicMcpMethod("notifications/initialized"), true);
  });

  it("rejects memory calls and mixed batches", () => {
    assert.equal(isPublicMcpMethod("tools/call"), false);
    assert.equal(
      isPublicMcpBody({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_memory" } }),
      false,
    );
    assert.equal(
      isPublicMcpBody([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_memory" } },
      ]),
      false,
    );
  });

  it("treats POST without Authorization as public when the body is handshake-only", async () => {
    const req = new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(await isPublicMcpHandshake(req), true);
  });

  it("treats POST handshake as public even with a bearer token", async () => {
    const req = new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer abc", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(await isPublicMcpHandshake(req), true);
  });

  it("does not treat tools/call as a public handshake", async () => {
    const req = new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_memory" } }),
    });
    assert.equal(await isPublicMcpHandshake(req), false);
  });
});
