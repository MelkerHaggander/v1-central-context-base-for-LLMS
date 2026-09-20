import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS, MCP_SERVER_INFO } from "../lib/mcp-instructions";

describe("MCP-instruktioner V1.1", () => {
  it("nämner de fyra verktygen i singular", () => {
    for (const tool of ["get_context", "save_memory", "update_memory", "lesson_memory"]) {
      assert.ok(MEMORY_INSTRUCTIONS.includes(tool), tool);
    }
    assert.doesNotMatch(MEMORY_INSTRUCTIONS, /search_memory/);
    assert.match(MEMORY_INSTRUCTIONS, /There is no tool named lesson-memory/);
  });

  it("kräver ett get_context-anrop med hela prompten", () => {
    const searchFirst = MEMORY_INSTRUCTIONS.split("1. SEARCH FIRST")[1]?.split("2. WRITE AFTER LEARNING")[0] ?? "";
    assert.match(searchFirst, /call get_context/);
    assert.match(searchFirst, /exactly once/);
    assert.match(searchFirst, /complete user message unchanged/);
    assert.match(searchFirst, /When get_context returns items, use those items/);
    assert.doesNotMatch(searchFirst, /Multiple searches/);
  });

  it("beskriver upsert och skyddade projekt- och category-byten", () => {
    assert.match(MEMORY_INSTRUCTIONS, /save_memory updates the existing row/);
    assert.match(MEMORY_INSTRUCTIONS, /allow_project_change: true/);
    assert.match(MEMORY_INSTRUCTIONS, /Never change an ordinary memory's category to "lesson"/);
  });

  it("förbjuder påhittat user_id och lögn om sparat", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Never request, invent or change a user identifier/);
    assert.match(MEMORY_INSTRUCTIONS, /Never\nclaim that information was saved when it was not/);
  });

  it("förbjuder radering via MCP", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Never delete memories/);
    assert.match(MEMORY_INSTRUCTIONS, /no delete_memory tool/);
  });

  it("kräver proaktiv sök, sparning, uppdatering och lärdomar", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Use memory proactively and frequently/);
    assert.match(MEMORY_INSTRUCTIONS, /SEARCH FIRST/);
    assert.match(MEMORY_INSTRUCTIONS, /There is no create_memory/);
    assert.match(MEMORY_INSTRUCTIONS, /Do not use lesson_memory for ordinary facts/);
    assert.match(MEMORY_INSTRUCTIONS, /WHAT was learned/);
    assert.match(MEMORY_INSTRUCTIONS, /Do not send category to lesson_memory/);
  });

  it("serverinfo är 1.1", () => {
    assert.equal(MCP_SERVER_INFO.name, "central-context-memory");
    assert.equal(MCP_SERVER_INFO.version, "1.1.0");
  });
});
