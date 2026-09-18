import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS, MCP_SERVER_INFO } from "../lib/mcp-instructions";

describe("MCP-instruktioner V1.1", () => {
  it("nämner de fem verktygen i singular", () => {
    for (const tool of ["get_context", "search_memory", "save_memory", "update_memory", "lesson_memory"]) {
      assert.ok(MEMORY_INSTRUCTIONS.includes(tool), tool);
    }
    assert.match(MEMORY_INSTRUCTIONS, /Use memory proactively and frequently/);
    assert.match(MEMORY_INSTRUCTIONS, /There is no tool named lesson-memory/);
    assert.match(MEMORY_INSTRUCTIONS, /There is no create_memory/);
    assert.match(MEMORY_INSTRUCTIONS, /Do not use lesson_memory for ordinary facts/);
  });

  it("kräver ett get_context-anrop med hela prompten och förbjuder legacy-sökning", () => {
    const searchFirst = MEMORY_INSTRUCTIONS.split("1. SEARCH FIRST")[1]?.split("2. WRITE AFTER LEARNING")[0] ?? "";
    assert.match(searchFirst, /call get_context/);
    assert.match(searchFirst, /exactly once/);
    assert.match(searchFirst, /complete user message unchanged/);
    assert.match(searchFirst, /Do not use search_memory/);
    assert.doesNotMatch(searchFirst, /use search_memory whenever|Call search_memory|Multiple searches/);
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
