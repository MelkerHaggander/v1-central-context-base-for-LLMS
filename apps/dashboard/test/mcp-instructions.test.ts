import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS, MCP_SERVER_INFO } from "../lib/mcp-instructions";

describe("MCP-instruktioner V1.5", () => {
  it("nämner de tre verktygen i singular", () => {
    for (const tool of ["search_memory", "save_memory", "update_memory"]) {
      assert.ok(MEMORY_INSTRUCTIONS.includes(tool), tool);
    }
  });

  it("förbjuder påhittat user_id och lögn om sparat", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Never request, invent or change a user identifier/);
    assert.match(MEMORY_INSTRUCTIONS, /Never\nclaim that information was saved when it was not/);
  });

  it("serverinfo är 1.5", () => {
    assert.equal(MCP_SERVER_INFO.name, "central-context-memory");
    assert.equal(MCP_SERVER_INFO.version, "1.5.0");
  });
});
