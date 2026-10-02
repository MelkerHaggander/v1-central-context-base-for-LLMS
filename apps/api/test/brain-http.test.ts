import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS } from "../lib/mcp-instructions";

const root = join(__dirname, "..");

function src(path: string) {
  return readFileSync(join(root, path), "utf8");
}

const mcpRouteSrc = src("app/api/mcp/route.ts");

describe("v1.2 brain HTTP", () => {
  it("lists exactly the two MCP tools, including the public handler", () => {
    const names = [...mcpRouteSrc.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names, ["get_context", "save_memory"]);
    assert.equal(mcpRouteSrc.match(/createMcpHandler\(/g)?.length, 1);
    assert.match(mcpRouteSrc, /return withChatGptToolList\(await handler\(req\)\)/);
    assert.doesNotMatch(MEMORY_INSTRUCTIONS, /update_memory|lesson_memory|search_memory/);
  });

  it("sends dashboard create, update and delete through the Python brain", () => {
    const list = src("app/api/memories/route.ts");
    const one = src("app/api/memories/[id]/route.ts");
    assert.match(list, /callPythonBrain\(\s*"save_dashboard"/);
    assert.match(list, /callPythonBrain\(\s*"search_in_space"/);
    assert.match(one, /callPythonBrain\(\s*"update_memory"/);
    assert.match(one, /callPythonBrain\(\s*"delete_memory"/);
    assert.match(one, /allow_project_change:\s*body\.allow_project_change === true/);
    assert.doesNotMatch(list, /@v1\/memory|createMemoryApi|createSupabaseStore/);
    assert.doesNotMatch(one, /@v1\/memory|createMemoryApi|createSupabaseStore/);
  });

  it("sends the four-field HTTP routes through the same Python entry", () => {
    const save = src("app/api/mcp/save_memory/route.ts");
    const update = src("app/api/mcp/update_memory/route.ts");
    const search = src("app/api/mcp/search_memory/route.ts");
    const lesson = src("app/api/mcp/lesson_memory/route.ts");
    assert.match(save, /callPythonBrain\(\s*"save_memory"/);
    assert.match(update, /callPythonBrain\(\s*"update_memory"/);
    assert.match(update, /allow_project_change:\s*body\.allow_project_change === true/);
    assert.match(search, /callPythonBrain\(\s*"search_memory"/);
    assert.match(lesson, /callPythonBrain\(\s*"save_lesson"/);
    assert.doesNotMatch(`${save}\n${update}\n${search}\n${lesson}`, /@v1\/memory|createMemoryApi/);
  });
});
