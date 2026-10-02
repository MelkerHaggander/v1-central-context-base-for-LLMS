import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockMemoryStore } from "../lib/mock/store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const PA = "5a0e0000-0000-4000-8000-000000000001";
const PB = "5a0e0000-0000-4000-8000-000000000002";
const SH = "5a0e0000-0000-4000-8000-0000000000ff";

function store() {
  return new MockMemoryStore([], [
    { id: PA, kind: "personal", members: [A] },
    { id: PB, kind: "personal", members: [B] },
    { id: SH, kind: "shared", members: [A, B] },
  ]);
}

const row = { project: "Boringcontext", category: "decision", title: "Tool", content: "Tool A" };

function ok<T>(r: { data: T } | { error: unknown }): T {
  assert.ok("data" in r, `expected data, got ${JSON.stringify(r)}`);
  return r.data;
}
function err(r: { data: unknown } | { error: { code: string } }): string {
  assert.ok("error" in r, `expected error, got ${JSON.stringify(r)}`);
  return r.error.code;
}

describe("mock follows the v1.2 space contract", () => {
  it("lists own personal space first, then shared, never someone else's personal", () => {
    const db = store();
    assert.deepEqual(db.listSpaces(A), [{ id: PA, kind: "personal" }, { id: SH, kind: "shared" }]);
    assert.deepEqual(db.listSpaces(C), []);
  });

  it("requires space_id and membership on read and write", () => {
    const db = store();
    assert.equal(err(db.searchInSpace(A, "", {})), "INVALID_SPACE");
    assert.equal(err(db.searchInSpace(A, PB, {})), "FORBIDDEN");
    assert.equal(err(db.saveInSpace(A, PB, row)), "FORBIDDEN");
    assert.equal(err(db.saveInSpace(A, "", row)), "INVALID_SPACE");
  });

  it("keeps personal and shared apart", () => {
    const db = store();
    ok(db.saveInSpace(A, PA, row));
    assert.equal(ok(db.searchInSpace(A, PA, {})).length, 1);
    assert.equal(ok(db.searchInSpace(A, SH, {})).length, 0);
    assert.equal(ok(db.searchInSpace(B, SH, {})).length, 0);
  });

  it("sets source dashboard and reuses the saved project spelling", () => {
    const db = store();
    ok(db.saveInSpace(A, SH, row));
    const second = ok(db.saveInSpace(B, SH, { ...row, project: "boring context", title: "Other" }));
    assert.equal(second.project, "Boringcontext");
    assert.equal(second.source, "dashboard");
    assert.equal(second.space_id, SH);
  });

  it("any member may edit and delete in shared, and every change is a version with who", () => {
    const db = store();
    const m = ok(db.saveInSpace(A, SH, row));
    ok(db.updateMemory(B, { ...row, id: m.id, content: "Tool B" }));
    const versions = ok(db.listVersions(A, m.id));
    assert.equal(versions.length, 1);
    assert.equal(versions[0].changed_by, B);
    assert.equal(versions[0].content_before, "Tool A");
    assert.equal(versions[0].content_after, "Tool B");
    assert.equal(versions[0].event, "update");
  });

  it("an identical edit writes no version and keeps updated_at", () => {
    const db = store();
    const m = ok(db.saveInSpace(A, SH, row));
    const again = ok(db.updateMemory(A, { ...row, id: m.id }));
    assert.equal(ok(db.listVersions(A, m.id)).length, 0);
    assert.equal(again.updated_at, m.updated_at);
  });

  it("a project or category change is a version too, with the values before", () => {
    const db = store();
    const m = ok(db.saveInSpace(A, SH, row));
    ok(db.updateMemory(A, { ...row, id: m.id, project: "Other", allow_project_change: true }));
    ok(db.updateMemory(A, { ...row, id: m.id, project: "Other", category: "fact" }));
    const versions = ok(db.listVersions(A, m.id));
    assert.equal(versions.length, 2);
    // Newest first. Version 2 was written before the category change.
    assert.equal(versions[0].version_number, 2);
    assert.equal(versions[0].project, "Other");
    assert.equal(versions[0].category, "decision");
    // Version 1 was written before the project change.
    assert.equal(versions[1].project, "Boringcontext");
    assert.equal(versions[1].content_before, versions[1].content_after);
  });

  it("an outsider cannot read the history of a shared row", () => {
    const db = store();
    const m = ok(db.saveInSpace(A, SH, row));
    assert.equal(err(db.listVersions(C, m.id)), "FORBIDDEN");
    assert.equal(err(db.updateMemory(C, { ...row, id: m.id })), "NOT_FOUND");
    assert.equal(err(db.deleteMemory(C, m.id)), "FORBIDDEN");
  });

  it("after delete the row is gone and its history can no longer be read, like the API", () => {
    const db = store();
    const m = ok(db.saveInSpace(A, SH, row));
    ok(db.deleteMemory(B, m.id));
    assert.equal(ok(db.searchInSpace(A, SH, {})).length, 0);
    assert.equal(err(db.listVersions(A, m.id)), "NOT_FOUND");
  });

  it("lists what was deleted in a space, with who and the text, for members only", () => {
    const db = store();
    const kept = ok(db.saveInSpace(A, SH, { ...row, title: "Kept" }));
    const gone = ok(db.saveInSpace(A, SH, row));
    ok(db.deleteMemory(B, gone.id));
    const deleted = ok(db.listDeletions(A, SH));
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].memory_id, gone.id);
    assert.equal(deleted[0].changed_by, B);
    assert.equal(deleted[0].title_before, "Tool");
    assert.equal(deleted[0].content_before, "Tool A");
    assert.equal(deleted[0].event, "delete");
    assert.ok(!deleted.some((v) => v.memory_id === kept.id));
    assert.equal(err(db.listDeletions(C, SH)), "FORBIDDEN");
    assert.equal(err(db.listDeletions(A, "")), "INVALID_SPACE");
    assert.deepEqual(ok(db.listDeletions(A, PA)), [], "another space's deletes are not listed");
  });
});

describe("mock follows the proposed team contract", () => {
  const emails: Record<string, string> = { [A]: "a@example.com", [B]: "b@example.com", [C]: "c@example.com" };
  function teams() {
    return new MockMemoryStore(
      [],
      [
        { id: PA, kind: "personal", members: [A] },
        { id: SH, kind: "shared", name: "Crew", members: [A, B] },
      ],
      {
        emailOf: (id) => emails[id] ?? null,
        idOfEmail: (e) => Object.keys(emails).find((id) => emails[id] === e) ?? null,
      },
    );
  }

  it("creates a named team with the caller as its only member", () => {
    const db = teams();
    const team = ok(db.createSpace(C, "  Mässa  "));
    assert.equal(team.kind, "shared");
    assert.equal(team.name, "Mässa");
    assert.deepEqual(ok(db.listMembers(C, team.id)).map((m) => m.user_id), [C]);
    assert.equal(err(db.createSpace(C, "   ")), "INVALID_NAME");
  });

  it("lists members with email, only to members", () => {
    const db = teams();
    assert.deepEqual(ok(db.listMembers(A, SH)).map((m) => m.email), ["a@example.com", "b@example.com"]);
    assert.equal(err(db.listMembers(C, SH)), "FORBIDDEN");
  });

  it("adds an existing account by email, once", () => {
    const db = teams();
    assert.equal(ok(db.addMember(A, SH, "C@Example.com ")).user_id, C);
    assert.equal(err(db.addMember(A, SH, "c@example.com")), "ALREADY_MEMBER");
    assert.equal(err(db.addMember(A, SH, "nobody@example.com")), "NO_ACCOUNT");
    assert.equal(err(db.addMember(A, SH, "not-an-email")), "INVALID_EMAIL");
    assert.ok(db.listSpaces(C).some((s) => s.id === SH));
  });

  it("never manages a personal space", () => {
    const db = teams();
    assert.equal(err(db.addMember(A, PA, "b@example.com")), "PERSONAL_SPACE");
    assert.equal(err(db.renameSpace(A, PA, "Mine")), "PERSONAL_SPACE");
  });

  it("removes and leaves, but never empties a team; the memories stay", () => {
    const db = teams();
    const m = ok(db.saveInSpace(B, SH, row));
    ok(db.removeMember(A, SH, B));
    assert.equal(err(db.searchInSpace(B, SH, {})), "FORBIDDEN");
    assert.equal(ok(db.searchInSpace(A, SH, {}))[0].id, m.id);
    assert.equal(err(db.removeMember(A, SH, A)), "LAST_MEMBER");
  });

  it("renames for any member and shows the name in the space list", () => {
    const db = teams();
    ok(db.renameSpace(B, SH, "Boringcontext"));
    assert.equal(db.listSpaces(A).find((s) => s.id === SH)?.name, "Boringcontext");
  });
});
