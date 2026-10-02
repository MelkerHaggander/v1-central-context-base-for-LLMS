import assert from "node:assert/strict";
import { test } from "node:test";

test("MCP client expires_in stays below the 2038 unix cap so ChatGPT does not drop the connector", async () => {
  const { mcpClientExpiresIn } = await import("./sessions");
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = mcpClientExpiresIn(now);
  assert.ok(now + expiresIn <= 2_147_483_647);
  assert.notEqual(expiresIn, 2_147_483_647);
});
