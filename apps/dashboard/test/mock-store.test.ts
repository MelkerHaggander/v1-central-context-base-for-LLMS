import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockMemoryStore, cleanSearchQuery, toIso } from "../lib/mock/store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const deadline = {
  project: "Projekt A",
  category: "deadline",
  title: "Lanseringsdatum",
  content: "Vi lanserar 15 oktober 2026.",
};

function ok<T>(r: { data: T } | { error: unknown }): T {
  assert.ok("data" in r, `förväntade data, fick ${JSON.stringify(r)}`);
  return r.data;
}

function err(r: { data: unknown } | { error: { code: string } }): string {
  assert.ok("error" in r, `förväntade error, fick ${JSON.stringify(r)}`);
  return r.error.code;
}

describe("mock-store följer contracts.md", () => {
  it("sparar med id och tidsstämpel i formatet YYYY-MM-DDTHH:MM:SSZ, aldrig user_id", () => {
    const db = new MockMemoryStore();
    const m = ok(db.saveMemory(A, deadline));
    assert.match(m.id, /^[0-9a-f-]{36}$/);
    assert.match(m.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(m.created_at, m.updated_at);
    assert.ok(!("user_id" in m));
  });

  it("validerar i ordningen project, title, content, category och trimmar", () => {
    const db = new MockMemoryStore();
    assert.equal(err(db.saveMemory(A, { ...deadline, project: "  " })), "INVALID_PROJECT");
    assert.equal(err(db.saveMemory(A, { ...deadline, title: "   " })), "INVALID_TITLE");
    assert.equal(err(db.saveMemory(A, { ...deadline, content: "" })), "INVALID_CONTENT");
    assert.equal(err(db.saveMemory(A, { ...deadline, category: "Deadline" })), "INVALID_CATEGORY");
    // Flera fel -> första i ordningen
    assert.equal(
      err(db.saveMemory(A, { project: "", title: "", content: "", category: "x" })),
      "INVALID_PROJECT",
    );
    const m = ok(db.saveMemory(A, { ...deadline, title: "  Trim  " }));
    assert.equal(m.title, "Trim");
  });

  it("identisk omsparning ger samma id och samma updated_at, ingen ny rad", () => {
    const db = new MockMemoryStore();
    const first = ok(db.saveMemory(A, deadline));
    const second = ok(db.saveMemory(A, deadline));
    assert.equal(second.id, first.id);
    assert.equal(second.updated_at, first.updated_at);
    assert.equal(ok(db.searchMemory(A, {})).length, 1);
  });

  it("isolerar konton: B ser inte A och kan inte uppdatera A:s id", () => {
    const db = new MockMemoryStore();
    const m = ok(db.saveMemory(A, deadline));
    assert.deepEqual(ok(db.searchMemory(B, {})), []);
    const r = db.updateMemory(B, { ...deadline, id: m.id, content: "Hackat" });
    assert.equal(err(r), "NOT_FOUND");
    assert.equal(ok(db.searchMemory(A, {}))[0].content, deadline.content);
  });

  it("saknad rad och annan ägare ger samma fel", () => {
    const db = new MockMemoryStore();
    const m = ok(db.saveMemory(A, deadline));
    const other = db.updateMemory(B, { ...deadline, id: m.id });
    const missing = db.updateMemory(A, { ...deadline, id: "550e8400-e29b-41d4-a716-446655440000" });
    assert.deepEqual(other, missing);
    assert.equal(err(db.updateMemory(A, { ...deadline, id: "inte-uuid" })), "INVALID_ID");
  });

  it("sök: query skiftlägesokänslig i title/content, project/category exakta", () => {
    const db = new MockMemoryStore();
    ok(db.saveMemory(A, deadline));
    ok(db.saveMemory(A, { ...deadline, category: "fact", title: "Tre testkonton", content: "Tre konton." }));
    assert.equal(ok(db.searchMemory(A, { query: "OKTOBER" })).length, 1);
    assert.equal(ok(db.searchMemory(A, { query: "finns-inte-xyz" })).length, 0);
    assert.equal(ok(db.searchMemory(A, { project: "Projekt a" })).length, 0);
    assert.equal(ok(db.searchMemory(A, { project: "Projekt A" })).length, 2);
    assert.equal(ok(db.searchMemory(A, { category: "deadline" })).length, 1);
    assert.equal(err(db.searchMemory(A, { category: "Deadline" })), "INVALID_CATEGORY");
    assert.equal(err(db.searchMemory(A, { offset: -1 })), "INVALID_OFFSET");
    assert.equal(err(db.searchMemory(A, { offset: 1.5 })), "INVALID_OFFSET");
  });

  it("sök: städar % _ , ( ) och tom query efter städ = inget filter", () => {
    assert.equal(cleanSearchQuery("%_,()"), "");
    assert.equal(cleanSearchQuery("a%b"), "a b");
    const db = new MockMemoryStore();
    ok(db.saveMemory(A, deadline));
    assert.equal(ok(db.searchMemory(A, { query: "%()" })).length, 1);
  });

  it("sidstorlek 50 och offset, senast uppdaterat först", () => {
    const seed = Array.from({ length: 60 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      user_id: A,
      project: "P",
      category: "fact" as const,
      title: `T${i}`,
      content: "c",
      created_at: toIso(new Date(Date.UTC(2026, 0, 1, 0, i))),
      updated_at: toIso(new Date(Date.UTC(2026, 0, 1, 0, i))),
    }));
    const db = new MockMemoryStore(seed);
    const page1 = ok(db.searchMemory(A, {}));
    assert.equal(page1.length, 50);
    assert.equal(page1[0].title, "T59");
    const page2 = ok(db.searchMemory(A, { offset: 50 }));
    assert.equal(page2.length, 10);
    assert.equal(page2[9].title, "T0");
  });

  it("update låser id och created_at, sätter alltid nytt updated_at", async () => {
    const db = new MockMemoryStore();
    const m = ok(db.saveMemory(A, deadline));
    await new Promise((r) => setTimeout(r, 1100));
    const u = ok(db.updateMemory(A, { ...deadline, id: m.id, content: "Vi lanserar 22 oktober 2026." }));
    assert.equal(u.id, m.id);
    assert.equal(u.created_at, m.created_at);
    assert.notEqual(u.updated_at, m.updated_at);
    assert.equal(ok(db.searchMemory(A, {})).length, 1);
  });

  it("tar category lesson och går att söka som Lärdom", () => {
    const db = new MockMemoryStore();
    const m = ok(
      db.saveMemory(A, {
        project: "Projekt A",
        category: "lesson",
        title: "Rätta category till gemener",
        content: "Ogiltig category ska rättas till gemener.",
      }),
    );
    assert.equal(m.category, "lesson");
    assert.equal(ok(db.searchMemory(A, { category: "lesson" })).length, 1);
  });
});
