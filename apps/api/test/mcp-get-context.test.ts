import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createInMemoryStore } from "../vendor/memory/src/in-memory";
import { createMemoryApi } from "../vendor/memory/src/store";
import {
  CHATGPT_OAUTH_SCHEMES,
  injectToolSecuritySchemes,
} from "../lib/mcp-chatgpt";
import { shouldChallengeMcpOAuth } from "../lib/mcp-oauth-challenge";

const mcpRouteSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
const httpRouteSrc = readFileSync(
  join(__dirname, "../app/api/mcp/get_context/route.ts"),
  "utf8",
);
const healthRouteSrc = readFileSync(join(__dirname, "../app/api/health/route.ts"), "utf8");

describe("get_context prompt transports", () => {
  it("registers the MCP tool with only prompt and optional project inputs", () => {
    const registration = mcpRouteSrc.match(
      /server\.tool\(\s*"get_context",[\s\S]*?\},\s*READ_TOOL,[\s\S]*?\n\s*\);/,
    )?.[0];
    assert.ok(registration);
    assert.match(registration, /prompt:\s*z\.string\(\)\.min\(1\)\.max\(8000\)/);
    assert.match(registration, /project:\s*z\.string\(\)\.max\(100\)\.optional\(\)/);
    assert.doesNotMatch(registration, /\b(?:keywords|query|category|offset):/);
    assert.match(registration, /\.getContext\(userId, input\)/);
  });

  it("keeps search_memory registered with a legacy-only description", () => {
    assert.match(mcpRouteSrc, /server\.tool\(\s*"search_memory"/);
    assert.match(
      mcpRouteSrc,
      /Legacy tool\. Do not use; call get_context with the full user prompt\./,
    );
  });

  it("keeps get_context visible in ChatGPT's public mixed-auth tool list", () => {
    const body = injectToolSecuritySchemes({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "get_context" }] },
    }) as {
      result: {
        tools: Array<{ name: string; securitySchemes: unknown }>;
      };
    };
    assert.equal(body.result.tools[0]?.name, "get_context");
    assert.deepEqual(body.result.tools[0]?.securitySchemes, CHATGPT_OAUTH_SCHEMES);
  });

  it("gives unauthenticated get_context calls the same challenge as legacy search", () => {
    const request = new Request("https://mcp.example.test/api/mcp", {
      method: "POST",
    });
    const call = (name: string) => ({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name },
    });
    assert.equal(
      shouldChallengeMcpOAuth(request, call("get_context")),
      shouldChallengeMcpOAuth(request, call("search_memory")),
    );
    assert.equal(shouldChallengeMcpOAuth(request, call("get_context")), true);
  });

  it("uses the same memory result for MCP and HTTP and advertises health support", () => {
    assert.match(mcpRouteSrc, /memoryApi\(extra\)\.getContext\(userId, input\)/);
    assert.match(httpRouteSrc, /api\.getContext\(data\.user\.id/);
    assert.match(mcpRouteSrc, /JSON\.stringify\(result\.data\)/);
    assert.match(httpRouteSrc, /jsonOk\(result\.data\)/);
    assert.match(healthRouteSrc, /mcp:\s*"1\.1\.0"/);
    assert.match(healthRouteSrc, /promptTransports:\s*true/);
  });

  it("returns compact items without full content, user id or timestamps", async () => {
    const memory = createMemoryApi(createInMemoryStore());
    const saved = await memory.saveMemory("user-a", {
      project: "Projekt A",
      category: "deadline",
      title: "Lanseringsdatum",
      content: "Vi lanserar 15 oktober 2026.",
    });
    assert.ok("data" in saved);

    const result = await memory.getContext("user-a", {
      prompt: "När ska vi lansera?",
      project: "Projekt A",
    });
    assert.ok("data" in result);
    assert.deepEqual(result.data.items[0], {
      id: saved.data.id,
      project: "Projekt A",
      category: "deadline",
      title: "Lanseringsdatum",
      snippet: "Vi lanserar 15 oktober 2026.",
    });
    const json = JSON.stringify(result.data);
    assert.doesNotMatch(json, /user_id|created_at|updated_at|"content":/);
  });
});
