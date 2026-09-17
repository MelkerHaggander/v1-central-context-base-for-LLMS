import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("MCP har inget radera-verktyg", () => {
  it("route.ts registrerar inte delete_memory", () => {
    const src = readFileSync(join(__dirname, "../app/api/mcp/route.ts"), "utf8");
    assert.equal(src.includes('"delete_memory"'), false);
    assert.equal(src.includes("'delete_memory'"), false);
    assert.ok(src.includes('"save_memory"'));
    assert.ok(src.includes('"update_memory"'));
    assert.ok(src.includes('"lesson_memory"'));
  });

  it("det finns ingen /api/mcp/delete_memory-rutt", () => {
    const names = readdirSync(join(__dirname, "../app/api/mcp"));
    assert.equal(names.includes("delete_memory"), false);
  });
});
