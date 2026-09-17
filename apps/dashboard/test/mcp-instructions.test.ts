import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS, MCP_SERVER_INFO } from "../lib/mcp-instructions";

describe("MCP-instruktioner V1.1", () => {
  it("nämner de fyra verktygen i singular", () => {
    for (const tool of ["search_memory", "save_memory", "update_memory", "lesson_memory"]) {
      assert.ok(MEMORY_INSTRUCTIONS.includes(tool), tool);
    }
    assert.match(MEMORY_INSTRUCTIONS, /HARD RULES for lesson_memory/);
    assert.match(MEMORY_INSTRUCTIONS, /There is no tool named lesson-memory/);
  });

  it("förbjuder påhittat user_id och lögn om sparat", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Never request, invent or change a user identifier/);
    assert.match(MEMORY_INSTRUCTIONS, /Never\nclaim that information was saved when it was not/);
  });

  it("serverinfo är 1.1", () => {
    assert.equal(MCP_SERVER_INFO.name, "central-context-memory");
    assert.equal(MCP_SERVER_INFO.version, "1.1.0");
  });
});
