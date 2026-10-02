import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isMissingEndpoint } from "../lib/api";
import { proxyToUpstream } from "../lib/upstream";

/**
 * "Not built yet" must never be confused with "failed". The team buttons hide
 * on the first and the panels show an error on the second.
 */
describe("upstream: a missing route is not a failure", () => {
  const realFetch = globalThis.fetch;
  const realBase = process.env.API_BASE_URL;
  let cancelled = 0;

  function answer(status: number, contentType: string, body: string) {
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
        cancel() {
          cancelled += 1;
        },
      });
      return new Response(stream, { status, headers: { "content-type": contentType } });
    }) as typeof fetch;
  }

  async function codeFor(status: number, contentType: string, body: string) {
    answer(status, contentType, body);
    const res = await proxyToUpstream(new Request("http://dash.test/api/spaces/x/members"), "/api/spaces/x/members");
    assert.ok(res);
    const json = (await res.json()) as { error?: { code: string } };
    return { status: res.status, code: json.error?.code };
  }

  beforeEach(() => {
    process.env.API_BASE_URL = "http://api.test";
    cancelled = 0;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realBase === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = realBase;
  });

  it("an HTML 404 or 405 is UPSTREAM_NO_ROUTE and counts as missing", async () => {
    for (const status of [404, 405]) {
      const out = await codeFor(status, "text/html", "<html>404</html>");
      assert.equal(out.code, "UPSTREAM_NO_ROUTE");
      assert.equal(out.status, status);
      assert.equal(isMissingEndpoint({ code: out.code!, message: "" }), true);
    }
  });

  it("an HTML 500 or a protection page is UPSTREAM_NOT_JSON and counts as a failure", async () => {
    for (const status of [500, 502, 401]) {
      const out = await codeFor(status, "text/html", "<html>oops</html>");
      assert.equal(out.code, "UPSTREAM_NOT_JSON");
      assert.equal(isMissingEndpoint({ code: out.code!, message: "" }), false);
    }
  });

  it("releases the unread body", async () => {
    await codeFor(404, "text/html", "<html>404</html>");
    assert.equal(cancelled, 1);
  });

  it("passes JSON through untouched, errors included", async () => {
    const out = await codeFor(403, "application/json", JSON.stringify({ error: { code: "FORBIDDEN", message: "no" } }));
    assert.equal(out.status, 403);
    assert.equal(out.code, "FORBIDDEN");
    assert.equal(isMissingEndpoint({ code: "FORBIDDEN", message: "" }), false);
    assert.equal(isMissingEndpoint({ code: "INVALID_RESPONSE", message: "" }), false);
  });
});
