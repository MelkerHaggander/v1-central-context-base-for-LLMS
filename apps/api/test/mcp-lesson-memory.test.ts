import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { MEMORY_INSTRUCTIONS } from "../lib/mcp-instructions";

const routeSrc = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
const httpSrc = readFileSync(join(__dirname, "../app/api/mcp/lesson_memory/route.ts"), "utf8");

describe("MCP-verktyget lesson_memory", () => {
  it("finns som fjärde verktyg och anropar saveLesson", () => {
    assert.match(routeSrc, /server\.tool\(\s*"lesson_memory"/);
    assert.match(routeSrc, /memoryApi\(extra\)\.saveLesson\(userId, input\)/);
  });

  it("save_memory tar inte category lesson", () => {
    const saveEnum = routeSrc.match(/SAVE_CATEGORIES = \[([^\]]+)\]/);
    assert.ok(saveEnum);
    assert.equal(saveEnum[1].includes("lesson"), false);
    assert.match(saveEnum[1], /fact/);
    assert.match(saveEnum[1], /preference/);

    const allEnum = routeSrc.match(/ALL_CATEGORIES = \[([^\]]+)\]/);
    assert.ok(allEnum);
    assert.match(allEnum[1], /lesson/);
  });

  it("HTTP-rutten ignorerar inskickad category och tvingar saveLesson", () => {
    assert.match(httpSrc, /api\.saveLesson/);
    assert.equal(/category:\s*String\(body\.category/.test(httpSrc), false);
  });

  it("instruktionerna skiljer lärdom från vanliga fakta", () => {
    assert.match(MEMORY_INSTRUCTIONS, /Do not use lesson_memory for ordinary facts/);
    assert.match(MEMORY_INSTRUCTIONS, /WHAT was learned/);
    assert.match(MEMORY_INSTRUCTIONS, /The server stores category "lesson"/);
  });
});
