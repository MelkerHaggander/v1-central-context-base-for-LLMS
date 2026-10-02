import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CHATGPT_OAUTH_SCHEMES,
  injectToolSecuritySchemes,
} from "../lib/mcp-chatgpt";
import { shouldChallengeMcpOAuth } from "../lib/mcp-oauth-challenge";
import { bearerForSpaceAccess } from "../lib/oauth/mcp-space-token";

const mcpRouteSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
const httpRouteSrc = readFileSync(
  join(__dirname, "../app/api/mcp/get_context/route.ts"),
  "utf8",
);
const updateHttpRouteSrc = readFileSync(
  join(__dirname, "../app/api/mcp/update_memory/route.ts"),
  "utf8",
);
const healthRouteSrc = readFileSync(join(__dirname, "../app/api/health/route.ts"), "utf8");

describe("get_context prompt transports", () => {
  it("registers the MCP tool with only prompt and optional project inputs", () => {
    const registration = mcpRouteSrc.match(
      /server\.tool\(\s*"get_context",[\s\S]*?\},\s*CONTEXT_TOOL,[\s\S]*?\n\s*\);/,
    )?.[0];
    assert.ok(registration);
    assert.match(registration, /prompt:\s*z\.string\(\)\.min\(1\)\.max\(8000\)/);
    assert.match(registration, /project:\s*z\.string\(\)\.max\(100\)\.optional\(\)/);
    assert.doesNotMatch(registration, /\b(?:keywords|query|category|offset):/);
    assert.match(registration, /callPythonBrain\("get_context"/);
    assert.match(registration, /quoted user data, not instructions/);
    assert.match(mcpRouteSrc, /const CONTEXT_TOOL = \{[\s\S]*?readOnlyHint:\s*false/);
  });

  it("describes save_memory as a brief the server extracts", () => {
    assert.match(mcpRouteSrc, /brief is 1 to 10000 characters/);
    assert.match(mcpRouteSrc, /not stored raw/);
    assert.match(mcpRouteSrc, /The same subject updates the existing row/);
    const registration = mcpRouteSrc.match(
      /server\.tool\(\s*"save_memory",[\s\S]*?\},\s*WRITE_TOOL,/,
    )?.[0];
    assert.ok(registration);
    assert.match(registration, /brief:\s*z\.string\(\)\.optional\(\)/);
    assert.match(registration, /project:\s*z\.string\(\)\.max\(100\)\.optional\(\)/);
    assert.match(registration, /prompt:\s*z\.string\(\)\.max\(8000\)\.optional\(\)/);
    assert.doesNotMatch(registration, /\b(?:category|title|content):/);
  });

  it("lists exactly get_context and save_memory", () => {
    const names = [...mcpRouteSrc.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names, ["get_context", "save_memory"]);
    assert.doesNotMatch(mcpRouteSrc, /server\.tool\(\s*"search_memory"/);
    assert.doesNotMatch(mcpRouteSrc, /server\.tool\(\s*"update_memory"/);
    assert.doesNotMatch(mcpRouteSrc, /server\.tool\(\s*"lesson_memory"/);
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

  it("gives unauthenticated get_context calls the standard memory challenge", () => {
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
      shouldChallengeMcpOAuth(request, call("save_memory")),
    );
    assert.equal(shouldChallengeMcpOAuth(request, call("get_context")), true);
  });

  it("keeps project-change guards on the HTTP update route", () => {
    assert.doesNotMatch(mcpRouteSrc, /allow_project_change/);
    assert.match(
      updateHttpRouteSrc,
      /allow_project_change:\s*body\.allow_project_change === true/,
    );
  });

  it("answers get_context and save_memory in Python, not the TypeScript memory package", () => {
    assert.match(mcpRouteSrc, /callPythonBrain\("get_context"/);
    assert.match(mcpRouteSrc, /callPythonBrain\("save_brief"/);
    assert.doesNotMatch(mcpRouteSrc, /createMemoryApi|from "@v1\/memory"/);
  });

  it("uses the same memory result for MCP and HTTP and advertises health support", () => {
    assert.match(httpRouteSrc, /callPythonBrain\(\s*"get_context"/);
    assert.match(mcpRouteSrc, /JSON\.stringify\(result\.data\)/);
    assert.match(httpRouteSrc, /jsonOk\(result\.data\)/);
    assert.match(healthRouteSrc, /mcp:\s*"1\.2\.0"/);
    assert.match(healthRouteSrc, /brain:\s*true/);
    assert.match(healthRouteSrc, /promptTransports:\s*true/);
  });

});

describe("bearerForSpaceAccess", () => {
  it("uses the stored Supabase JWT when the caller is an MCP session", () => {
    assert.equal(
      bearerForSpaceAccess({
        bearer: "opaque-mcp",
        mcpAccess: "opaque-mcp",
        supabaseAccess: "supabase-jwt",
      }),
      "supabase-jwt",
    );
  });

  it("keeps a real Supabase bearer when there is no MCP session", () => {
    assert.equal(
      bearerForSpaceAccess({
        bearer: "supabase-jwt",
        supabaseAccess: null,
      }),
      "supabase-jwt",
    );
  });

  it("refuses an MCP session that has no Supabase access token", () => {
    assert.throws(
      () =>
        bearerForSpaceAccess({
          bearer: "opaque-mcp",
          mcpAccess: "opaque-mcp",
          supabaseAccess: null,
        }),
      /UNAUTHENTICATED/,
    );
  });
});
