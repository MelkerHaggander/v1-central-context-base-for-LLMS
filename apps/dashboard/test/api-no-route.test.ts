import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createTeam, fetchDeleted, fetchMembers, isMissingEndpoint, unreadableBody } from "../lib/api";
import { isApiError } from "../lib/types";

/**
 * apps/api has no proxy in front of its routes. A route that does not exist
 * answers with Next's HTML 404 page (GET) or an empty 405 (POST on a GET-only
 * route). That must read as "not built yet", so the team buttons hide, and not
 * as "the server is broken".
 */
describe("a missing route without the proxy", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function answer(status: number, contentType: string, body: string | null) {
    globalThis.fetch = (async () =>
      new Response(body, { status, headers: body === null ? {} : { "Content-Type": contentType } })) as typeof fetch;
  }

  it("names a non-JSON 404 or 405 as a missing endpoint", () => {
    assert.equal(unreadableBody(404).error.code, "NO_ROUTE");
    assert.equal(unreadableBody(405).error.code, "NO_ROUTE");
    assert.equal(isMissingEndpoint(unreadableBody(404).error), true);
  });

  it("keeps anything else a failure", () => {
    for (const status of [200, 500, 502, 504]) {
      const out = unreadableBody(status);
      assert.equal(out.error.code, "INVALID_RESPONSE");
      assert.equal(isMissingEndpoint(out.error), false);
    }
  });

  it("the members probe gets NO_ROUTE from Next's HTML 404 page", async () => {
    answer(404, "text/html", "<!DOCTYPE html><html><body>404: This page could not be found.</body></html>");
    const out = await fetchMembers("44444444-4444-4444-8444-444444444444");
    assert.ok(isApiError(out));
    assert.equal(out.error.code, "NO_ROUTE");
    assert.equal(isMissingEndpoint(out.error), true);
  });

  it("creating a team gets NO_ROUTE from an empty 405", async () => {
    answer(405, "", null);
    const out = await createTeam("Sales");
    assert.ok(isApiError(out));
    assert.equal(out.error.code, "NO_ROUTE");
  });

  it("a JSON error still wins over the status", async () => {
    answer(404, "application/json", JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }));
    const out = await fetchMembers("44444444-4444-4444-8444-444444444444");
    assert.ok(isApiError(out));
    assert.equal(out.error.code, "NOT_FOUND");
  });

  it("the deleted list keeps delete events only, newest first", async () => {
    const v = (n: number, event: string, at: string) => ({
      version_number: n, memory_id: `m${n}`, space_id: "s", changed_by: "u", event, project: "P", category: "fact",
      title_before: "T", title_after: "", content_before: "C", content_after: "", source: "dashboard", created_at: at,
    });
    answer(200, "application/json", JSON.stringify([
      v(1, "delete", "2026-09-29T09:00:00Z"),
      v(2, "update", "2026-09-29T11:00:00Z"),
      v(3, "delete", "2026-09-29T10:00:00Z"),
    ]));
    const out = await fetchDeleted("s");
    assert.ok(!isApiError(out));
    assert.deepEqual(out.map((r) => r.memory_id), ["m3", "m1"]);
  });
});
