import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChecklist,
  dayKey,
  doneDate,
  dueDate,
  findDates,
  isDone,
  markDone,
  reopen,
} from "../lib/checklist";
import type { Memory } from "../lib/types";

const written = new Date(2026, 8, 22); // 22 Sep 2026
const keys = (dates: Date[]) => dates.map(dayKey);

function mem(p: Partial<Memory>): Memory {
  return {
    id: p.id ?? "11111111-1111-4111-8111-111111111111",
    project: "P",
    category: "deadline",
    title: "T",
    content: "C",
    created_at: "2026-09-22T09:00:00Z",
    updated_at: "2026-09-22T09:00:00Z",
    ...p,
  };
}

describe("findDates", () => {
  it("reads ISO, day-month and month-day, English and Swedish", () => {
    assert.deepEqual(keys(findDates("Release 2026-10-15.", written)), ["2026-10-15"]);
    assert.deepEqual(keys(findDates("Monday 5 October: run the migration", written)), ["2026-10-05"]);
    assert.deepEqual(keys(findDates("ihopkopplade måndag 5 oktober", written)), ["2026-10-05"]);
    assert.deepEqual(keys(findDates("Vi lanserar 15 oktober 2026.", written)), ["2026-10-15"]);
    assert.deepEqual(keys(findDates("due October 3rd", written)), ["2026-10-03"]);
    assert.deepEqual(keys(findDates("klart 5:e nov", written)), ["2026-11-05"]);
  });

  it("keeps a recent past date in this year and rolls far past dates to next year", () => {
    assert.deepEqual(keys(findDates("due 20 September 14:00", written)), ["2026-09-20"]);
    assert.deepEqual(keys(findDates("kickoff 10 January", written)), ["2027-01-10"]);
  });

  it("does not see months inside words or impossible days", () => {
    assert.deepEqual(findDates("5 decisions and 3 marsupials", written), []);
    assert.deepEqual(findDates("31 September", written), []);
  });

  it("returns dates in the order they appear", () => {
    assert.deepEqual(keys(findDates("from 1 October to 2026-12-24", written)), ["2026-10-01", "2026-12-24"]);
  });
});

describe("dueDate: rather miss a date than invent an overdue one", () => {
  const d = (p: Partial<Memory>) => {
    const due = dueDate(mem(p));
    return due ? dayKey(due) : null;
  };

  it("a deadline is due on its latest date", () => {
    assert.equal(d({ content: "Decided on 3 September: ship the beta by 20 December" }), "2026-12-20");
    assert.equal(d({ content: "Deadline moved from 1 October to 15 November" }), "2026-11-15");
  });

  it("a goal only has a due date after a due-word", () => {
    assert.equal(d({ category: "goal", content: "Based on the 2026-01-15 board meeting, reach 100 paying teams" }), null);
    assert.equal(d({ category: "goal", content: "Reach 100 paying teams by 1 December" }), "2026-12-01");
    assert.equal(d({ category: "goal", content: "Klart senast 5 november" }), "2026-11-05");
  });

  it("lowercase may is the verb", () => {
    assert.equal(d({ content: "Team of 1 may be remote" }), null);
    assert.equal(d({ content: "Launch 1 May" }), "2027-05-01");
  });

  it("the year follows when the text was last written, not created", () => {
    assert.equal(
      d({ content: "by 15 October", created_at: "2025-09-01T09:00:00Z", updated_at: "2026-09-20T09:00:00Z" }),
      "2026-10-15",
    );
  });
});

describe("done line", () => {
  it("adds, reads and removes it", () => {
    const done = markDone("Ship it.", "2026-09-28")!;
    assert.equal(done, "Ship it.\n\nDone: 2026-09-28");
    assert.equal(doneDate(done), "2026-09-28");
    assert.equal(isDone({ content: done }), true);
    assert.equal(reopen(done), "Ship it.");
  });

  it("marking twice keeps one line, and reopen leaves other text alone", () => {
    const twice = markDone(markDone("A", "2026-09-01")!, "2026-09-28")!;
    assert.equal(twice, "A\n\nDone: 2026-09-28");
    assert.equal(reopen("Nothing done here"), "Nothing done here");
    assert.equal(doneDate("We are done: 2026-09-28 was the plan. More text."), null);
  });

  it("refuses to break the content limit", () => {
    assert.equal(markDone("x".repeat(9990), "2026-09-28"), null);
  });

  it("the done line never becomes the due date", () => {
    const m = mem({ content: "No date here.\n\nDone: 2026-09-28" });
    assert.equal(dueDate(m), null);
  });
});

describe("buildChecklist", () => {
  const now = new Date(2026, 8, 28, 12); // 28 Sep 2026
  const list = buildChecklist(
    [
      mem({ id: "a", title: "V1.1 goals due", content: "Due 20 September 14:00." }),
      mem({ id: "b", title: "Integration day", content: "Monday 5 October." }),
      mem({ id: "c", category: "goal", title: "Open source", content: "Public once isolation is proven." }),
      mem({ id: "d", title: "Old one", content: "Was 1 September.\n\nDone: 2026-09-02" }),
      mem({ id: "e", category: "fact", title: "Not a task", content: "15 September" }),
      mem({ id: "f", title: "Today", content: "Due 28 September." }),
    ],
    now,
  );

  it("sorts goals and deadlines into overdue, upcoming, undated and done", () => {
    assert.deepEqual(list.overdue.map((i) => i.memory.id), ["a"]);
    assert.deepEqual(list.upcoming.map((i) => i.memory.id), ["f", "b"]);
    assert.deepEqual(list.undated.map((i) => i.memory.id), ["c"]);
    assert.deepEqual(list.done.map((i) => i.memory.id), ["d"]);
  });

  it("a date that is today is not overdue yet, and facts are not tasks", () => {
    assert.equal(list.upcoming[0].overdue, false);
    const all = [...list.overdue, ...list.upcoming, ...list.undated, ...list.done];
    assert.ok(!all.some((i) => i.memory.id === "e"));
  });
});
