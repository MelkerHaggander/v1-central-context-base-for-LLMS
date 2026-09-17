import assert from "node:assert/strict";
import { test } from "node:test";
import { validateMemoryId, validateMemoryInput, validateSearchInput } from "../src/validate";

test("rejects invalid category and does not look like success", () => {
  const result = validateMemoryInput({
    project: "Projekt A",
    category: "nope",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_CATEGORY");
});

test("accepts Lanseringsdatum", () => {
  const result = validateMemoryInput({
    project: "Projekt A",
    category: "deadline",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("data" in result);
  assert.equal(result.data.category, "deadline");
});

test("accepts lesson category", () => {
  const result = validateMemoryInput({
    project: "Projekt A",
    category: "lesson",
    title: "Rätta category till gemener",
    content: "Ogiltig category ska rättas till gemener.",
  });
  assert.ok("data" in result);
  assert.equal(result.data.category, "lesson");
});

test("search accepts category lesson", () => {
  const result = validateSearchInput({ category: "lesson" });
  assert.ok("data" in result);
  assert.equal(result.data.category, "lesson");
});

test("search miss query is still valid", () => {
  const result = validateSearchInput({ query: "finns-inte-xyz" });
  assert.ok("data" in result);
  assert.equal(result.data.query, "finns-inte-xyz");
});

test("rejects a non-uuid id", () => {
  const result = validateMemoryId("not-an-id");
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_ID");
});

test("trims before length", () => {
  const result = validateMemoryInput({
    project: "  Projekt A  ",
    category: " deadline ",
    title: "  Lanseringsdatum  ",
    content: "  Vi lanserar 15 oktober 2026.  ",
  });
  assert.ok("data" in result);
  assert.equal(result.data.project, "Projekt A");
  assert.equal(result.data.title, "Lanseringsdatum");
  assert.equal(result.data.content, "Vi lanserar 15 oktober 2026.");
  assert.equal(result.data.category, "deadline");
});

test("blank title is INVALID_TITLE", () => {
  const result = validateMemoryInput({
    project: "Projekt A",
    category: "deadline",
    title: "   ",
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_TITLE");
});

test("error order project then title then content then category", () => {
  const allEmpty = validateMemoryInput({
    project: "",
    category: "nope",
    title: "",
    content: "",
  });
  assert.ok("error" in allEmpty);
  assert.equal(allEmpty.error.code, "INVALID_PROJECT");

  const badTitle = validateMemoryInput({
    project: "Projekt A",
    category: "nope",
    title: "",
    content: "",
  });
  assert.ok("error" in badTitle);
  assert.equal(badTitle.error.code, "INVALID_TITLE");

  const badContent = validateMemoryInput({
    project: "Projekt A",
    category: "nope",
    title: "Lanseringsdatum",
    content: "",
  });
  assert.ok("error" in badContent);
  assert.equal(badContent.error.code, "INVALID_CONTENT");

  const badCategory = validateMemoryInput({
    project: "Projekt A",
    category: "nope",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("error" in badCategory);
  assert.equal(badCategory.error.code, "INVALID_CATEGORY");
});

test("rejects a non-integer offset", () => {
  const result = validateSearchInput({ offset: 1.5 });
  assert.ok("error" in result);
  assert.equal(result.error.code, "INVALID_OFFSET");
});

test("rejects too long project title and content", () => {
  const tooLongProject = validateMemoryInput({
    project: "x".repeat(101),
    category: "deadline",
    title: "Lanseringsdatum",
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("error" in tooLongProject);
  assert.equal(tooLongProject.error.code, "INVALID_PROJECT");

  const tooLongTitle = validateMemoryInput({
    project: "Projekt A",
    category: "deadline",
    title: "x".repeat(151),
    content: "Vi lanserar 15 oktober 2026.",
  });
  assert.ok("error" in tooLongTitle);
  assert.equal(tooLongTitle.error.code, "INVALID_TITLE");

  const tooLongContent = validateMemoryInput({
    project: "Projekt A",
    category: "deadline",
    title: "Lanseringsdatum",
    content: "x".repeat(10_001),
  });
  assert.ok("error" in tooLongContent);
  assert.equal(tooLongContent.error.code, "INVALID_CONTENT");
});

test("blank search query becomes no text filter", () => {
  const result = validateSearchInput({ query: "   " });
  assert.ok("data" in result);
  assert.equal(result.data.query, undefined);
});
