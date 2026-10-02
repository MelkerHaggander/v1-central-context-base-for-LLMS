import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayKey, dueDate, markDone, reopen, withDue } from "../lib/checklist";
import {
  dateRule,
  dueProblem,
  impossibleDateProblem,
  impossibleDates,
  readDue,
  realDay,
  splitDue,
} from "../lib/due";
import type { Memory } from "../lib/types";

function mem(p: Partial<Memory>): Memory {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    project: "P",
    category: "deadline",
    title: "T",
    content: "C",
    created_at: "2026-09-22T09:00:00Z",
    updated_at: "2026-09-22T09:00:00Z",
    ...p,
  };
}

describe("realDay", () => {
  it("takes real calendar days only", () => {
    assert.ok(realDay("2026-10-15"));
    assert.ok(realDay("2028-02-29"));
    assert.equal(realDay("2027-02-29"), null);
    assert.equal(realDay("2026-02-30"), null);
    assert.equal(realDay("2026-13-01"), null);
    assert.equal(realDay("2026-00-10"), null);
    assert.equal(realDay("15 October 2026"), null);
    assert.equal(realDay(""), null);
  });

  it("refuses years outside 2000-2099, so a typo in the year is caught", () => {
    assert.equal(realDay("1999-12-31"), null);
    assert.equal(realDay("2100-01-01"), null);
    assert.ok(realDay("2000-01-01"));
    assert.ok(realDay("2099-12-31"));
  });
});

describe("the Due line", () => {
  it("is read, split off and put back", () => {
    const content = "We launch at the fair.\n\nDue: 2026-10-15";
    assert.equal(readDue(content), "2026-10-15");
    assert.deepEqual(splitDue(content), { body: "We launch at the fair.", due: "2026-10-15" });
    assert.equal(withDue("We launch at the fair.", "2026-10-15"), content);
  });

  it("goes before a checklist Done line, which must stay last", () => {
    const done = markDone("Ship the build.", "2026-10-02")!;
    const both = withDue(done, "2026-10-01");
    assert.equal(both, "Ship the build.\n\nDue: 2026-10-01\n\nDone: 2026-10-02");
    assert.equal(reopen(both), "Ship the build.\n\nDue: 2026-10-01");
    assert.deepEqual(splitDue(both), { body: "Ship the build.\n\nDone: 2026-10-02", due: "2026-10-01" });
  });

  it("ignores a Due line that is not a real day", () => {
    assert.equal(readDue("Text\n\nDue: 2026-02-30"), null);
    assert.equal(splitDue("Text\n\nDue: 2026-02-30").due, null);
  });

  it("leaves text without a date alone", () => {
    assert.equal(withDue("Just text", null), "Just text");
    assert.deepEqual(splitDue("Just text"), { body: "Just text", due: null });
  });

  it("wins over other dates in the text in the checklist", () => {
    const m = mem({ content: "Decided 3 Sep, moved to 20 December.\n\nDue: 2026-11-01" });
    assert.equal(dayKey(dueDate(m)!), "2026-11-01");
    const goal = mem({ category: "goal", content: "Grow the pilot.\n\nDue: 2026-12-01" });
    assert.equal(dayKey(dueDate(goal)!), "2026-12-01");
  });
});

describe("impossibleDates", () => {
  it("finds dates that cannot exist, in English and Swedish", () => {
    assert.deepEqual(impossibleDates("Launch 2026-02-30."), ["2026-02-30"]);
    assert.deepEqual(impossibleDates("Release 2026-13-01"), ["2026-13-01"]);
    assert.deepEqual(impossibleDates("Vi lanserar 32 oktober"), ["32 oktober"]);
    assert.deepEqual(impossibleDates("due April 31"), ["April 31"]);
    assert.deepEqual(impossibleDates("den 30 februari 2026"), ["30 februari 2026"]);
    assert.deepEqual(impossibleDates("29 February 2027"), ["29 February 2027"]);
  });

  it("leaves real dates, a bare 29 February and the verb may alone", () => {
    assert.deepEqual(impossibleDates("Launch 15 October 2026, review 2026-10-20, April 30"), []);
    assert.deepEqual(impossibleDates("Every 29 February"), []);
    assert.deepEqual(impossibleDates("Item 40 may be late"), []);
    assert.deepEqual(impossibleDates("20 September 14:00"), []);
  });

  it("is a sentence the editor can show", () => {
    assert.equal(impossibleDateProblem("Launch", "On 31 april"), '"31 april" is not a real date. Fix it, or use the date field.');
    assert.equal(impossibleDateProblem("Launch", "On 30 april"), null);
  });
});

describe("dueProblem", () => {
  it("requires a date on a deadline, not on a goal, and nothing elsewhere", () => {
    assert.equal(dateRule("deadline"), "required");
    assert.equal(dateRule("goal"), "optional");
    assert.equal(dateRule("fact"), null);
    assert.match(dueProblem("deadline", "")!, /needs a date/);
    assert.equal(dueProblem("goal", ""), null);
    assert.equal(dueProblem("fact", ""), null);
  });

  it("refuses a half-typed or impossible date", () => {
    assert.match(dueProblem("deadline", "", true)!, /Finish the date/);
    assert.match(dueProblem("goal", "2026-02-30")!, /real date/);
    assert.match(dueProblem("deadline", "20266-10-15")!, /real date/);
    assert.equal(dueProblem("deadline", "2026-10-15"), null);
  });
});
