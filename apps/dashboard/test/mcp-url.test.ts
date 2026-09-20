import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDurableMcpUrl, mcpUrl, STABLE_MCP_URL, visibleMcpUrl } from "../lib/mcp-url";

describe("mcpUrl", () => {
  it("använder NEXT_PUBLIC_MCP_URL om den är en stabil egen adress", () => {
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

  it("byter inte till en unik Vercel-hash, så dokumentet inte går ut", () => {
    const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
    process.env.NEXT_PUBLIC_MCP_URL =
      "https://v1-central-context-base-for-llms-gczsl799b.vercel.app/api/mcp";
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

describe("isDurableMcpUrl", () => {
  it("godkänner bara production-aliaset bland vercel.app-värdar", () => {
    assert.equal(isDurableMcpUrl(STABLE_MCP_URL), true);
    assert.equal(isDurableMcpUrl("https://v1-central-context-base-for-llms.vercel.app/api/mcp/"), true);
    assert.equal(
      isDurableMcpUrl("https://v1-central-context-base-for-llms-ausd5rwta.vercel.app/api/mcp"),
      false,
    );
    assert.equal(isDurableMcpUrl("http://localhost:3000/api/mcp"), false);
  });
});

describe("visibleMcpUrl", () => {
  it("visar alltid production-adressen om inkommande URL är tom eller unik", () => {
    assert.equal(visibleMcpUrl(""), STABLE_MCP_URL);
    assert.equal(visibleMcpUrl("https://v1-central-context-bas-git-7f4021-barrettaalfredo-hues-projects.vercel.app/api/mcp"), STABLE_MCP_URL);
    assert.equal(visibleMcpUrl(STABLE_MCP_URL), STABLE_MCP_URL);
  });
});
