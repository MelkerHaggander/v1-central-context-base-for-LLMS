import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchClientMetadata,
  isAllowedClientMetadataUrl,
  isPrivateOrReservedIp,
} from "./client-metadata";

test("allows ChatGPT, Claude and Grok client metadata hosts", () => {
  assert.equal(isAllowedClientMetadataUrl("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(isAllowedClientMetadataUrl("https://www.claude.ai/.well-known/oauth-client"), true);
  assert.equal(isAllowedClientMetadataUrl("https://chatgpt.com/connector.json"), true);
  assert.equal(isAllowedClientMetadataUrl("https://platform.openai.com/client.json"), true);
  assert.equal(isAllowedClientMetadataUrl("https://grok.com/oauth/client"), true);
  assert.equal(isAllowedClientMetadataUrl("https://x.ai/oauth/client"), true);
  assert.equal(isAllowedClientMetadataUrl("https://anthropic.com/oauth/client"), true);
});

test("rejects SSRF client_id URLs", () => {
  assert.equal(isAllowedClientMetadataUrl("https://evil.example/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://claude.ai.evil.example/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("http://claude.ai/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://127.0.0.1/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowedClientMetadataUrl("https://localhost/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://user:pass@claude.ai/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://claude.ai:8443/client.json"), false);
  assert.equal(isAllowedClientMetadataUrl("https://metadata.google.internal/"), false);
  assert.equal(isAllowedClientMetadataUrl("not-a-url"), false);
});

test("treats loopback, private and link-local IPs as blocked", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("10.0.0.5"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.9"), true);
  assert.equal(isPrivateOrReservedIp("172.16.0.2"), true);
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedIp("::1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
});

test("does not fetch disallowed client_id URLs", async () => {
  let fetched = false;
  const result = await fetchClientMetadata("https://127.0.0.1/secret", {
    fetchImpl: async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    },
    lookupImpl: async () => ["127.0.0.1"],
  });
  assert.equal(result, null);
  assert.equal(fetched, false);
});

test("does not fetch when DNS resolves to a private IP", async () => {
  let fetched = false;
  const result = await fetchClientMetadata("https://claude.ai/client.json", {
    fetchImpl: async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    },
    lookupImpl: async () => ["10.0.0.8"],
  });
  assert.equal(result, null);
  assert.equal(fetched, false);
});

test("reads redirect_uris from an allowlisted client metadata document", async () => {
  const result = await fetchClientMetadata("https://chatgpt.com/client.json", {
    lookupImpl: async () => ["1.1.1.1"],
    fetchImpl: async () =>
      new Response(JSON.stringify({ redirect_uris: ["https://chatgpt.com/api/mcp/auth_callback"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(result, {
    client_id: "https://chatgpt.com/client.json",
    redirect_uris: ["https://chatgpt.com/api/mcp/auth_callback"],
  });
});
