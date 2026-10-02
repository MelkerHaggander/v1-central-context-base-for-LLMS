import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepSource, reviewKey, sourceKnown, toReview, withReviewed } from "../lib/review";
import type { Memory } from "../lib/types";

function mem(p: Partial<Memory>): Memory {
  return {
    id: "a",
    project: "P",
    category: "fact",
    title: "T",
    content: "C",
    created_at: "2026-09-20T09:00:00Z",
    updated_at: "2026-09-20T09:00:00Z",
    ...p,
  };
}

describe("review inbox", () => {
  it("only exists when the rows carry source at all", () => {
    assert.equal(sourceKnown([mem({})]), false);
    assert.equal(sourceKnown([mem({ source: null })]), true);
    assert.equal(sourceKnown([mem({ source: "brain" })]), true);
  });

  it("lists what the AI saved and nobody has reviewed, newest first", () => {
    const rows = [
      mem({ id: "old", source: "brain", updated_at: "2026-09-20T09:00:00Z" }),
      mem({ id: "new", source: "brain", updated_at: "2026-09-27T09:00:00Z" }),
      mem({ id: "mine", source: "dashboard" }),
      mem({ id: "legacy", source: null }),
    ];
    assert.deepEqual(toReview(rows, new Set()).map((m) => m.id), ["new", "old"]);
    assert.deepEqual(toReview(rows, new Set([reviewKey(rows[1])])).map((m) => m.id), ["old"]);
  });

  it("comes back when the memory changes after the review", () => {
    const before = mem({ id: "x", source: "brain", updated_at: "2026-09-20T09:00:00Z" });
    const after = { ...before, updated_at: "2026-09-28T09:00:00Z", content: "overwritten by the AI" };
    const reviewed = new Set([reviewKey(before)]);
    assert.deepEqual(toReview([after], reviewed).map((m) => m.id), ["x"]);
    const retitled = { ...before, title: "Another title" };
    assert.deepEqual(toReview([retitled], reviewed).map((m) => m.id), ["x"]);
  });

  it("stays reviewed when only updated_at moves (the embedding write on the live database)", () => {
    const kept = mem({ id: "x", source: "brain", updated_at: "2026-09-29T09:00:00Z" });
    const bumped = { ...kept, updated_at: "2026-09-29T09:00:02Z" };
    assert.deepEqual(toReview([bumped], new Set([reviewKey(kept)])), []);
  });

  it("still honours keys saved in the old id@updated_at format", () => {
    const row = mem({ id: "x", source: "brain", updated_at: "2026-09-20T09:00:00Z" });
    assert.deepEqual(toReview([row], new Set(["x@2026-09-20T09:00:00Z"])), []);
  });

  it("keeps the newest keys within the limit and never duplicates", () => {
    assert.deepEqual(withReviewed(["a", "b"], ["b", "c"], 10), ["a", "b", "c"]);
    assert.deepEqual(withReviewed(["a", "b", "c"], ["d"], 3), ["b", "c", "d"]);
  });

  it("keeps the source the list knew when a save answers without it", () => {
    const listed = mem({ id: "x", source: "brain" });
    const saved = mem({ id: "x", title: "Fixed" }); // no source key, like POST and PATCH on the live API
    assert.equal(keepSource(saved, listed, true).source, "brain");
    assert.equal(keepSource(saved, undefined, true).source, "dashboard", "a new row saved here is from the dashboard");
    assert.equal(keepSource({ ...saved, source: null }, listed, true).source, null, "what the server sends wins");
    assert.equal(Object.prototype.hasOwnProperty.call(keepSource(saved, undefined, false), "source"), false, "no source list, no inbox");
  });
});
