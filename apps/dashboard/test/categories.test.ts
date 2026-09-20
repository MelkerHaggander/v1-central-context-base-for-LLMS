import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATEGORY_LABEL, DISPLAY_ORDER } from "../lib/categories";
import { CATEGORIES, CATEGORY_LABELS } from "../lib/types";

describe("dashboard category catalog", () => {
  it("has the six v1.1 wire values in English labels", () => {
    assert.deepEqual([...CATEGORIES], ["fact", "decision", "goal", "deadline", "preference", "lesson"]);
    assert.deepEqual([...DISPLAY_ORDER], [...CATEGORIES]);
    assert.equal(CATEGORY_LABEL.fact, "Fact");
    assert.equal(CATEGORY_LABEL.decision, "Decision");
    assert.equal(CATEGORY_LABEL.goal, "Goal");
    assert.equal(CATEGORY_LABEL.deadline, "Deadline");
    assert.equal(CATEGORY_LABEL.preference, "Preference");
    assert.equal(CATEGORY_LABEL.lesson, "Lesson");
    assert.deepEqual(CATEGORY_LABELS, CATEGORY_LABEL);
    for (const label of Object.values(CATEGORY_LABEL)) {
      assert.match(label, /^[A-Za-z ]+$/);
      assert.equal(label === "Faktum" || label === "Beslut" || label === "Lärdom", false);
    }
  });
});
