import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS } from "../lib/mcp-instructions";

const routeSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
const httpSrc = readFileSync(join(__dirname, "../app/api/mcp/lesson_memory/route.ts"), "utf8");

describe("lesson_memory är HTTP, inte MCP", () => {
  it("finns inte i tools/list", () => {
    assert.doesNotMatch(routeSrc, /server\.tool\(\s*"lesson_memory"/);
    assert.doesNotMatch(MEMORY_INSTRUCTIONS, /lesson_memory/);
    assert.match(MEMORY_INSTRUCTIONS, /The server chooses the category/);
  });

  it("HTTP-rutten ignorerar inskickad category och tvingar saveLesson", () => {
    assert.match(httpSrc, /api\.saveLesson/);
    assert.equal(/category:\s*String\(body\.category/.test(httpSrc), false);
  });
});
