import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countByCategory, filterMemories, summarise, summariseProjects } from "../lib/aggregate";
import { DISPLAY_ORDER } from "../lib/categories";
import { firstProblem } from "../lib/validate-fields";
import type { Memory } from "../lib/types";

function row(over: Partial<Memory> & { id: string }): Memory {
  return {
    project: "A",
    category: "fact",
    title: "t",
    content: "c",
    created_at: "2026-09-10T12:00:00Z",
    updated_at: "2026-09-10T12:00:00Z",
    ...over,
  } as Memory;
}

describe("aggregate", () => {
  it("always reports all six categories in the fixed order, zeros included", () => {
    const counts = countByCategory([row({ id: "1", category: "lesson" })]);
    assert.deepEqual(
      counts.map((c) => c.category),
      [...DISPLAY_ORDER],
    );
    assert.equal(counts.find((c) => c.category === "lesson")!.count, 1);
    assert.equal(counts.find((c) => c.category === "fact")!.count, 0);
  });

  it("appends a category the API invents rather than dropping the rows", () => {
    const counts = countByCategory([row({ id: "1", category: "surprise" as Memory["category"] })]);
    assert.equal(counts.length, DISPLAY_ORDER.length + 1);
    assert.equal(counts[counts.length - 1].category, "surprise");
  });

  it("summarises projects by count and newest change", () => {
    const projects = summariseProjects([
      row({ id: "1", project: "A", updated_at: "2026-09-10T12:00:00Z" }),
      row({ id: "2", project: "A", updated_at: "2026-09-18T09:00:00Z" }),
      row({ id: "3", project: "B" }),
    ]);
    assert.equal(projects[0].project, "A");
    assert.equal(projects[0].count, 2);
    assert.equal(projects[0].lastUpdated, "2026-09-18T09:00:00Z");
    assert.equal(projects[1].project, "B");
    // A project summary only lists the categories it actually has.
    assert.deepEqual(
      projects[1].byCategory.map((c) => c.category),
      ["fact"],
    );
  });

  it("carries the truncation flag instead of claiming a total it cannot know", () => {
    const partial = summarise([row({ id: "1" })], false);
    assert.equal(partial.complete, false);
    assert.equal(partial.memories, 1);
    assert.equal(summarise([row({ id: "1" })], true).complete, true);
    assert.equal(summarise([], true).newest, null);
  });

  it("filters on project, category and text in title or content", () => {
    const rows = [
      row({ id: "1", title: "Launch date", content: "15 October" }),
      row({ id: "2", project: "B", category: "goal", title: "Open source", content: "before launch" }),
    ];
    assert.equal(filterMemories(rows, { project: "B" }).length, 1);
    assert.equal(filterMemories(rows, { category: "goal" }).length, 1);
    assert.equal(filterMemories(rows, { query: "OCTOBER" }).length, 1);
    assert.equal(filterMemories(rows, { query: "launch" }).length, 2);
    assert.equal(filterMemories(rows, { query: "  " }).length, 2);
    assert.equal(filterMemories(rows, { query: "nothing-here" }).length, 0);
  });
});

describe("field validation mirrors the server", () => {
  const good = { project: "A", category: "fact", title: "t", content: "c" };

  it("reports the first failure in the server's order", () => {
    assert.equal(firstProblem(good), null);
    assert.match(firstProblem({ ...good, project: "  " })!, /project/i);
    assert.match(firstProblem({ ...good, title: "" })!, /title/i);
    assert.match(firstProblem({ ...good, content: "" })!, /content/i);
    assert.match(firstProblem({ ...good, category: "Deadline" })!, /category/i);
    // Several problems at once: project wins, exactly like INVALID_PROJECT does.
    assert.match(firstProblem({ project: "", category: "x", title: "", content: "" })!, /project/i);
  });

  it("enforces the same lengths and trims first", () => {
    assert.equal(firstProblem({ ...good, project: "p".repeat(100) }), null);
    assert.ok(firstProblem({ ...good, project: "p".repeat(101) }));
    assert.equal(firstProblem({ ...good, title: "t".repeat(150) }), null);
    assert.ok(firstProblem({ ...good, title: "t".repeat(151) }));
    assert.equal(firstProblem({ ...good, content: "c".repeat(10_000) }), null);
    assert.ok(firstProblem({ ...good, content: "c".repeat(10_001) }));
    assert.equal(firstProblem({ ...good, title: "  ok  " }), null);
  });

  it("accepts lesson, because POST /api/memories does", () => {
    assert.equal(firstProblem({ ...good, category: "lesson" }), null);
  });
});
