import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changedSince,
  defaultSpace,
  exportFileName,
  exportJson,
  exportMarkdown,
  findDuplicates,
  groupDeletedByProject,
  isNew,
  latestChange,
  orderSpaces,
  restoreState,
  pickSpace,
  projectKey,
  projectMatch,
  spaceLabel,
  teamMoveLabel,
  whoChanged,
  withAfterValues,
} from "../lib/insights";
import type { Memory, MemoryVersion, Space } from "../lib/types";

const P: Space = { id: "p", kind: "personal" };
const S: Space = { id: "s", kind: "shared" };

function mem(over: Partial<Memory>): Memory {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    project: "Boringcontext",
    category: "fact",
    title: "T",
    content: "c",
    created_at: "2026-09-20T10:00:00Z",
    updated_at: "2026-09-20T10:00:00Z",
    ...over,
  };
}

describe("spaces", () => {
  it("labels by kind because spaces have no name", () => {
    assert.equal(spaceLabel(P), "Personal");
    assert.equal(spaceLabel(S), "Team");
    assert.equal(spaceLabel(null), "No space");
    assert.equal(spaceLabel({ kind: "shared", name: " Mässa " }), "Mässa");
    assert.equal(spaceLabel({ kind: "personal", name: "ignored" }), "Personal");
  });

  it("formats team destinations for the Move menu", () => {
    assert.equal(teamMoveLabel({ kind: "shared", name: "Boringcontext" }), "Boringcontext (Teams)");
    assert.equal(teamMoveLabel({ kind: "shared", name: "sales" }), "sales (Teams)");
    assert.equal(teamMoveLabel({ kind: "shared" }), "Team (Teams)");
  });

  it("defaults to personal even when shared comes first", () => {
    assert.equal(defaultSpace([S, P])?.id, "p");
    assert.equal(defaultSpace([S])?.id, "s");
    assert.equal(defaultSpace([]), null);
  });

  it("keeps a remembered space only while the user is still a member", () => {
    assert.equal(pickSpace([P, S], "s")?.id, "s");
    assert.equal(pickSpace([P], "s")?.id, "p");
    assert.equal(pickSpace([P, S], null)?.id, "p");
  });
});

describe("new and changed", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  it("marks rows created in the last 24 hours by created_at", () => {
    assert.equal(isNew(mem({ created_at: "2026-09-27T00:00:00Z" }), now), true);
    assert.equal(isNew(mem({ created_at: "2026-09-26T12:00:00Z" }), now), true);
    assert.equal(isNew(mem({ created_at: "2026-09-26T11:59:00Z" }), now), false);
    assert.equal(isNew(mem({ created_at: "garbage" }), now), false);
  });

  it("changedSince compares updated_at with the previous visit", () => {
    assert.equal(changedSince(mem({ updated_at: "2026-09-27T10:00:00Z" }), "2026-09-27T09:00:00Z"), true);
    assert.equal(changedSince(mem({ updated_at: "2026-09-27T08:00:00Z" }), "2026-09-27T09:00:00Z"), false);
    assert.equal(changedSince(mem({}), null), false);
  });
});

describe("project matching mirrors the server", () => {
  it("uses the same key as brain.ts", () => {
    assert.equal(projectKey("Boring Context"), projectKey("boring-context"));
    assert.equal(projectKey("Boring Context"), "boringcontext");
  });

  it("names the saved spelling only when it differs", () => {
    const existing = ["Boringcontext", "Infra"];
    assert.equal(projectMatch("Boring Context", existing), "Boringcontext");
    assert.equal(projectMatch("Boringcontext", existing), null);
    assert.equal(projectMatch("New thing", existing), null);
    assert.equal(projectMatch("   ", existing), null);
  });
});

describe("duplicates", () => {
  it("finds the same title in one project regardless of case and spacing", () => {
    const pairs = findDuplicates([
      mem({ id: "a", title: "Launch date", content: "15 Oct" }),
      mem({ id: "b", title: "launch  Date", content: "Something else entirely", created_at: "2026-09-21T10:00:00Z" }),
    ]);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].reason, "same title");
    assert.equal(pairs[0].a.id, "a");
  });

  it("finds reworded copies and ignores other projects", () => {
    const one = mem({ id: "1", title: "Open source plus hosted", content: "Open source code for technical users, a paid hosted service for everyone else." });
    const two = mem({ id: "2", title: "Open source and a hosted plan", content: "The code is open source. Non-technical users pay for a hosted service." });
    const elsewhere = mem({ id: "3", project: "Other", title: "Open source plus hosted", content: one.content });
    const pairs = findDuplicates([one, two, elsewhere]);
    assert.equal(pairs.length, 1);
    assert.deepEqual([pairs[0].a.id, pairs[0].b.id].sort(), ["1", "2"]);
    assert.ok(pairs[0].score >= 0.5);
  });

  it("does not flag unrelated rows in the same project", () => {
    const pairs = findDuplicates([
      mem({ id: "1", title: "Embedding model", content: "OpenAI text-embedding-3-large, dimension 3072." }),
      mem({ id: "2", title: "Brain model", content: "Always Claude Sonnet 5, temperature 0." }),
    ]);
    assert.equal(pairs.length, 0);
  });
});

describe("export", () => {
  const rows = [mem({ id: "1", title: "B", project: "Z" }), mem({ id: "2", title: "A", project: "Y", source: "brain" })];
  const meta = { space: "Personal", exportedAt: "2026-09-27T12:00:00Z" };

  it("JSON carries every field the list has and a count", () => {
    const parsed = JSON.parse(exportJson(rows, meta));
    assert.equal(parsed.format, "boringcontext-export");
    assert.equal(parsed.count, 2);
    assert.equal(parsed.memories[1].source, "brain");
    assert.equal("source" in parsed.memories[0], false);
    assert.equal("user_id" in parsed.memories[0], false);
  });

  it("Markdown groups by project in order", () => {
    const md = exportMarkdown(rows, meta);
    assert.ok(md.indexOf("## Y") < md.indexOf("## Z"));
    assert.match(md, /^# Boringcontext export: Personal/);
  });

  it("file name says space and date", () => {
    assert.equal(exportFileName("Team", new Date("2026-09-27T12:00:00Z"), "md"), "boringcontext-team-2026-09-27.md");
  });
});

describe("whoChanged", () => {
  const me = "11111111-1111-4111-8111-111111111111";
  const them = "22222222-2222-4222-8222-222222222222";
  it("is You for the reader, in any space", () => {
    assert.equal(whoChanged({ changed_by: me }, me, "shared"), "You");
    assert.equal(whoChanged({ changed_by: me }, me, "personal"), "You");
  });
  it("is always You in a personal space, which has one member", () => {
    assert.equal(whoChanged({ changed_by: them }, me, "personal"), "You");
  });
  it("is the email when the members list knows the id, else a short id", () => {
    const people = new Map([[them, "melker@example.com"]]);
    assert.equal(whoChanged({ changed_by: them }, me, "shared", people), "melker@example.com");
    assert.equal(whoChanged({ changed_by: them }, me, "shared"), "A teammate (22222222)");
    assert.equal(whoChanged({ changed_by: them }, me, "shared", new Map()), "A teammate (22222222)");
  });
});

describe("latestChange", () => {
  const v = (version_number: number, created_at: string) => ({ version_number, created_at });
  it("is the highest version whatever order the server sends", () => {
    assert.deepEqual(latestChange([v(1, "2026-09-28T10:00:00Z"), v(3, "2026-09-29T09:00:00Z"), v(2, "2026-09-28T12:00:00Z")]), v(3, "2026-09-29T09:00:00Z"));
  });
  it("is null for a memory never changed since it was saved", () => {
    assert.equal(latestChange([]), null);
  });
});

describe("restoreState", () => {
  const gone = { project: "Boring Context", category: "decision" as const, title_before: "Tool", content_before: "Tool A" };
  const m = (p: Partial<Memory>): Pick<Memory, "project" | "category" | "title" | "content"> => ({
    project: "Boringcontext",
    category: "decision",
    title: "Tool",
    content: "Tool A",
    ...p,
  });
  it("is restorable when nothing with that title is in the space", () => {
    assert.equal(restoreState(gone, []), "restorable");
    assert.equal(restoreState(gone, [m({ title: "Other" })]), "restorable");
    assert.equal(restoreState(gone, [m({ category: "fact" })]), "restorable");
  });
  it("is restored when the same title and text are back, matching projects like the server", () => {
    assert.equal(restoreState(gone, [m({})]), "restored");
  });
  it("is taken when a memory with that title has other text, so a restore would overwrite it", () => {
    assert.equal(restoreState(gone, [m({ content: "Tool B, decided later" })]), "taken");
  });
});

describe("withAfterValues", () => {
  const v = (over: Partial<MemoryVersion>): MemoryVersion => ({
    version_number: 1,
    memory_id: "m",
    space_id: "s",
    changed_by: "u",
    event: "update",
    project: "A",
    category: "fact",
    title_before: "T",
    title_after: "T",
    content_before: "c",
    content_after: "c",
    source: "dashboard",
    created_at: "2026-10-02T08:00:00Z",
    ...over,
  });

  it("takes the after value from the next version, and the live row for the newest", () => {
    const out = withAfterValues(
      [
        v({ version_number: 1, project: "A", category: "fact" }),
        v({ version_number: 2, project: "B", category: "fact" }),
      ],
      { project: "B", category: "goal" },
    );
    // Newest first.
    assert.equal(out[0].version_number, 2);
    assert.equal(out[0].project_after, "B");
    assert.equal(out[0].category_after, "goal");
    assert.equal(out[1].version_number, 1);
    assert.equal(out[1].project_after, "B");
    assert.equal(out[1].category_after, "fact");
  });

  it("sorts whatever order the server sends and leaves deletes without an after", () => {
    const out = withAfterValues(
      [v({ version_number: 2, event: "delete" }), v({ version_number: 1, project: "A" })],
      null,
    );
    assert.equal(out[0].event, "delete");
    assert.equal(out[0].project_after, null);
    // The delete row carries the project before it; that is the after of version 1.
    assert.equal(out[1].project_after, "A");
  });
});

describe("groupDeletedByProject", () => {
  const del = (over: Partial<MemoryVersion> & Pick<MemoryVersion, "memory_id" | "project" | "title_before">): MemoryVersion => ({
    version_number: 1,
    space_id: "s",
    changed_by: "u",
    event: "delete",
    category: "fact",
    title_after: "",
    content_before: "c",
    content_after: "",
    source: "dashboard",
    created_at: "2026-10-02T08:00:00Z",
    ...over,
  });

  it("groups named projects and keeps free-standing separate", () => {
    const groups = groupDeletedByProject([
      del({ memory_id: "1", project: "Projekt A", title_before: "One" }),
      del({ memory_id: "2", project: "projekt a", title_before: "Two" }),
      del({ memory_id: "3", project: "", title_before: "Loose" }),
      del({ memory_id: "4", project: "Infra", title_before: "Server" }),
    ]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].isProject, true);
    assert.equal(groups[0].label, "Projekt A");
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[1].isProject, false);
    assert.equal(groups[1].label, "");
    assert.equal(groups[1].items[0].title_before, "Loose");
    assert.equal(groups[2].label, "Infra");
  });
});

describe("orderSpaces", () => {
  it("puts personal first, then teams by name, unnamed teams as Team", () => {
    const out = orderSpaces([
      { id: "c", kind: "shared", name: "Launch crew" },
      { id: "b", kind: "shared" },
      { id: "a", kind: "shared", name: "Boringcontext" },
      { id: "z", kind: "personal" },
    ]);
    assert.deepEqual(out.map((s) => s.id), ["z", "a", "c", "b"]);
  });
});
