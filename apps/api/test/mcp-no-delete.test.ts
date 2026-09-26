import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("MCP har inget radera-verktyg", () => {
  it("route.ts registrerar inte delete_memory", () => {
    const src = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
    assert.equal(src.includes('"delete_memory"'), false);
    assert.equal(src.includes("'delete_memory'"), false);
    assert.equal(src.includes('"update_memory"'), false);
    assert.equal(src.includes('"lesson_memory"'), false);
    const names = [...src.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(names, ["get_context", "save_memory"]);
  });

  it("HTTP-rutterna för update och lesson finns kvar, delete_memory gör det inte", () => {
    const names = readdirSync(join(__dirname, "../app/api/mcp"));
    assert.equal(names.includes("delete_memory"), false);
    assert.equal(names.includes("update_memory"), true);
    assert.equal(names.includes("lesson_memory"), true);
  });
});
