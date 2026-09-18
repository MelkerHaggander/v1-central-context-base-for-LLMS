import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mcpUrl, STABLE_MCP_URL } from "../lib/claude-instructions";

describe("mcpUrl", () => {
  it("använder NEXT_PUBLIC_MCP_URL om den är en stabil adress", () => {
    const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL = "https://example.test/api/mcp";
    try {
      assert.equal(mcpUrl(), "https://example.test/api/mcp");
    } finally {
      if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
      else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
    }
  });

  it("byter inte till en unik -git- preview, så dokumentet inte går ut", () => {
    const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL =
      "https://v1-central-context-bas-git-9a1309-barrettaalfredo-hues-projects.vercel.app/api/mcp";
    try {
      assert.equal(mcpUrl(), STABLE_MCP_URL);
    } finally {
      if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
      else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
    }
  });

  it("faller tillbaka på den stabila production-adressen", () => {
    const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
    delete process.env.NEXT_PUBLIC_MCP_URL;
    try {
      assert.equal(mcpUrl(), STABLE_MCP_URL);
    } finally {
      if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
      else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
    }
  });
});
