import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideTabSession, memoryBelongsToTab } from "../lib/tab-session";

describe("decideTabSession", () => {
  it("signed-out when cookie is empty", () => {
    assert.deepEqual(decideTabSession("user-a", null), { action: "signed-out" });
    assert.deepEqual(decideTabSession(null, null), { action: "signed-out" });
  });

  it("binds the first account this tab sees", () => {
    assert.deepEqual(decideTabSession(null, "user-a"), { action: "bind", userId: "user-a" });
  });

  it("ok when tab and cookie are the same account", () => {
    assert.deepEqual(decideTabSession("user-a", "user-a"), { action: "ok", userId: "user-a" });
  });

  it("mismatch when another tab logged in as someone else", () => {
    assert.deepEqual(decideTabSession("user-a", "user-b"), {
      action: "mismatch",
      boundId: "user-a",
      cookieUserId: "user-b",
    });
  });
});

describe("memoryBelongsToTab", () => {
  it("rejects another account's list", () => {
    assert.equal(memoryBelongsToTab("user-a", "user-b"), false);
  });

  it("accepts matching owner header", () => {
    assert.equal(memoryBelongsToTab("user-a", "user-a"), true);
  });

  it("does not fail closed on older deploys without the header", () => {
    assert.equal(memoryBelongsToTab("user-a", null), true);
  });
});
