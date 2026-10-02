import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDurableMcpUrl, mcpUrl, stableMcpUrl, visibleMcpUrl } from "../lib/mcp-url";

const HOST = "memory.example";
const STABLE = `https://${HOST}/api/mcp`;

function withHost(run: () => void) {
  const prevHost = process.env.NEXT_PUBLIC_MCP_HOST;
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_MCP_HOST = HOST;
  delete process.env.NEXT_PUBLIC_APP_URL;
  try {
    run();
  } finally {
    if (prevHost === undefined) delete process.env.NEXT_PUBLIC_MCP_HOST;
    else process.env.NEXT_PUBLIC_MCP_HOST = prevHost;
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
  }
}

describe("mcpUrl", () => {
  it("använder NEXT_PUBLIC_MCP_URL om den är en stabil egen adress", () => {
    withHost(() => {
      const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
      process.env.NEXT_PUBLIC_MCP_URL = "https://example.test/api/mcp";
      try {
        assert.equal(mcpUrl(), "https://example.test/api/mcp");
      } finally {
        if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
        else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
      }
    });
  });

  it("byter inte till en unik -git- preview, så dokumentet inte går ut", () => {
    withHost(() => {
      const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
      process.env.NEXT_PUBLIC_MCP_URL =
        "https://v1-central-context-bas-git-9a1309-barrettaalfredo-hues-projects.vercel.app/api/mcp";
      try {
        assert.equal(mcpUrl(), STABLE);
        assert.equal(stableMcpUrl(), STABLE);
      } finally {
        if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
        else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
      }
    });
  });

  it("byter inte till en unik Vercel-hash, så dokumentet inte går ut", () => {
    withHost(() => {
      const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
      process.env.NEXT_PUBLIC_MCP_URL =
        "https://v1-central-context-base-for-llms-gczsl799b.vercel.app/api/mcp";
      try {
        assert.equal(mcpUrl(), STABLE);
      } finally {
        if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
        else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
      }
    });
  });

  it("faller tillbaka på den konfigurerade production-adressen", () => {
    withHost(() => {
      const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
      delete process.env.NEXT_PUBLIC_MCP_URL;
      try {
        assert.equal(mcpUrl(), STABLE);
      } finally {
        if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
        else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
      }
    });
  });

  it("pekar inte på en annan värd när ingen publik adress är satt", () => {
    const prevHost = process.env.NEXT_PUBLIC_MCP_HOST;
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    const prevMcp = process.env.NEXT_PUBLIC_MCP_URL;
    delete process.env.NEXT_PUBLIC_MCP_HOST;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_MCP_URL;
    try {
      assert.equal(mcpUrl(), "");
      assert.equal(mcpUrl().includes("vercel.app"), false);
    } finally {
      if (prevHost === undefined) delete process.env.NEXT_PUBLIC_MCP_HOST;
      else process.env.NEXT_PUBLIC_MCP_HOST = prevHost;
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevApp;
      if (prevMcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
      else process.env.NEXT_PUBLIC_MCP_URL = prevMcp;
    }
  });
});

describe("isDurableMcpUrl", () => {
  it("godkänner bara den konfigurerade värden bland vercel.app-värdar", () => {
    withHost(() => {
      assert.equal(isDurableMcpUrl(STABLE), true);
      assert.equal(isDurableMcpUrl(`${STABLE}/`), true);
      assert.equal(
        isDurableMcpUrl("https://v1-central-context-base-for-llms-ausd5rwta.vercel.app/api/mcp"),
        false,
      );
      assert.equal(isDurableMcpUrl("http://localhost:3000/api/mcp"), false);
    });
  });
});

describe("visibleMcpUrl", () => {
  it("visar den konfigurerade adressen om inkommande URL är tom eller unik", () => {
    withHost(() => {
      assert.equal(visibleMcpUrl(""), STABLE);
      assert.equal(
        visibleMcpUrl(
          "https://v1-central-context-bas-git-7f4021-barrettaalfredo-hues-projects.vercel.app/api/mcp",
        ),
        STABLE,
      );
      assert.equal(visibleMcpUrl(STABLE), STABLE);
    });
  });
});
