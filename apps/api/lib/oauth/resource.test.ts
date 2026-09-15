import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalMcpResource, resourceAllowed } from "./resource";

test("empty resource is allowed so Claude still works", () => {
  assert.equal(resourceAllowed("https://app.example", ""), true);
});

test("resource must be this host's /api/mcp", () => {
  const origin = "https://app.example";
  assert.equal(resourceAllowed(origin, "https://app.example/api/mcp"), true);
  assert.equal(resourceAllowed(origin, "https://app.example/api/mcp/"), true);
  assert.equal(resourceAllowed(origin, "https://evil.example/api/mcp"), false);
  assert.equal(resourceAllowed(origin, "https://app.example"), false);
});

test("canonical resource has no trailing slash", () => {
  assert.equal(canonicalMcpResource("https://app.example/"), "https://app.example/api/mcp");
});
