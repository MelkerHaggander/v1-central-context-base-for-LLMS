import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizationServerMetadataResponse } from "../lib/oauth/authorization-server";
import { protectedResourceMetadataResponse } from "../lib/oauth/protected-resource";

function req(url: string) {
  return new Request(url, {
    headers: {
      host: "v1-alfredo-experiment.vercel.app",
      "x-forwarded-host": "v1-alfredo-experiment.vercel.app",
      "x-forwarded-proto": "https",
    },
  });
}

describe("OAuth discovery for ChatGPT", () => {
  it("advertises resource_parameter_supported on the authorization server", async () => {
    const body = await authorizationServerMetadataResponse(req("https://v1-alfredo-experiment.vercel.app/.well-known/oauth-authorization-server")).json();
    assert.equal(body.resource_parameter_supported, true);
    assert.equal(body.registration_endpoint, "https://v1-alfredo-experiment.vercel.app/oauth/register");
  });

  it("returns the MCP resource from both root and path-scoped PRM URLs", async () => {
    const expected = "https://v1-alfredo-experiment.vercel.app/api/mcp";
    const root = await protectedResourceMetadataResponse(
      req("https://v1-alfredo-experiment.vercel.app/.well-known/oauth-protected-resource"),
    ).json();
    const nested = await protectedResourceMetadataResponse(
      req("https://v1-alfredo-experiment.vercel.app/.well-known/oauth-protected-resource/api/mcp"),
    ).json();
    assert.equal(root.resource, expected);
    assert.equal(nested.resource, expected);
    assert.deepEqual(root.bearer_methods_supported, ["header"]);
  });
});
