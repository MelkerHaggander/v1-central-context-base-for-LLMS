import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeleteQueue, type DeleteOutcome } from "../lib/delete-queue";

/** Manual clock: timers only fire when the test says so. */
function harness(fail: ReadonlySet<string> = new Set(), opts: { allow?: () => Promise<boolean> } = {}) {
  let now = 1000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextTimer = 1;
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const settled: DeleteOutcome[] = [];
  let changes = 0;

  const queue = new DeleteQueue({
    delayMs: 8000,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
    deleteOne: async (id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(id);
      await Promise.resolve();
      inFlight -= 1;
      return fail.has(id) ? { error: { code: "FORBIDDEN", message: "no" } } : { error: null };
    },
    beforeBatch: opts.allow,
    onChange: () => {
      changes += 1;
    },
    onSettled: (o) => settled.push(o),
  });

  async function advance(ms: number) {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
    // Let the delete chain run.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  return { queue, calls, settled, advance, maxInFlight: () => maxInFlight, changes: () => changes };
}

describe("delete queue: undo before anything is sent", () => {
  it("hides at once, deletes only after the delay", async () => {
    const h = harness();
    h.queue.schedule(["a", "b"], "2 memories");
    assert.deepEqual([...h.queue.hiddenIds()].sort(), ["a", "b"]);
    await h.advance(7999);
    assert.deepEqual(h.calls, []);
    await h.advance(1);
    assert.deepEqual(h.calls, ["a", "b"]);
    assert.equal(h.settled.length, 1);
    assert.deepEqual(h.settled[0].gone, ["a", "b"]);
    // Gone rows stay hidden, so the next refresh cannot flash them back.
    assert.equal(h.queue.isHidden("a"), true);
    assert.deepEqual(h.queue.pending(), []);
  });

  it("undo within the delay sends nothing and shows the rows again", async () => {
    const h = harness();
    const batch = h.queue.schedule(["a"], "Title")!;
    assert.equal(h.queue.undo(batch.key), true);
    assert.equal(h.queue.isHidden("a"), false);
    await h.advance(10_000);
    assert.deepEqual(h.calls, []);
    assert.equal(h.queue.undo(batch.key), false);
  });

  it("a failed row comes back, the rest stay gone", async () => {
    const h = harness(new Set(["b"]));
    h.queue.schedule(["a", "b", "c"], "3 memories");
    await h.advance(8000);
    assert.deepEqual(h.settled[0].gone, ["a", "c"]);
    assert.deepEqual(h.settled[0].failed, ["b"]);
    assert.equal(h.settled[0].error?.code, "FORBIDDEN");
    assert.equal(h.queue.isHidden("b"), false);
    assert.equal(h.queue.isHidden("a"), true);
  });

  it("never sends two DELETEs at the same time, even across batches", async () => {
    const h = harness();
    h.queue.schedule(["a", "b"], "x");
    await h.advance(1000);
    h.queue.schedule(["c", "d"], "y");
    await h.advance(7000); // first batch due
    await h.advance(1000); // second batch due
    assert.deepEqual(h.calls, ["a", "b", "c", "d"]);
    assert.equal(h.maxInFlight(), 1);
  });

  it("ignores ids that are already on their way out", () => {
    const h = harness();
    h.queue.schedule(["a"], "x");
    assert.equal(h.queue.schedule(["a"], "x again"), null);
    const second = h.queue.schedule(["a", "b"], "y")!;
    assert.deepEqual(second.ids, ["b"]);
  });

  it("closing the tab sends what is waiting instead of undoing it", async () => {
    const h = harness();
    h.queue.schedule(["a"], "x");
    h.queue.schedule(["b", "c"], "y");
    const sent: string[] = [];
    h.queue.flushOnUnload((id) => sent.push(id));
    assert.deepEqual(sent.sort(), ["a", "b", "c"]);
    assert.deepEqual(h.queue.pending(), []);
    assert.equal(h.queue.isHidden("a"), true, "sent on unload counts as gone");
    await h.advance(10_000);
    assert.deepEqual(h.calls, [], "the timers are gone, nothing is sent twice");
  });

  it("closing the tab in the middle of a batch also sends what had not gone out yet", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    const { DeleteQueue: Q } = await import("../lib/delete-queue");
    let fire!: () => void;
    const q = new Q({
      delayMs: 10,
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
      deleteOne: async (id) => {
        calls.push(id);
        await gate;
        return { error: null };
      },
      onChange: () => {},
      onSettled: () => {},
    });
    q.schedule(["a", "b", "c"], "3 memories");
    fire();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.deepEqual(calls, ["a"], "one at a time, a is in flight");
    const sent: string[] = [];
    q.flushOnUnload((id) => sent.push(id));
    assert.deepEqual(sent.sort(), ["a", "b", "c"]);
    release();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.deepEqual(calls, ["a"], "b and c are not sent a second time by the loop");
  });

  it("tells the view after an unload, so toasts do not linger after the back button", () => {
    const h = harness();
    h.queue.schedule(["a"], "x");
    const before = h.changes();
    h.queue.flushOnUnload(() => {});
    assert.equal(h.changes(), before + 1);
  });

  it("a batch is not sent when another account has signed in", async () => {
    const h = harness(new Set(), { allow: async () => false });
    h.queue.schedule(["a", "b"], "2 memories");
    await h.advance(8000);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.settled[0].failed, ["a", "b"]);
    assert.equal(h.settled[0].error?.code, "ACCOUNT_SWITCHED");
    assert.equal(h.queue.isHidden("a"), false, "the rows come back");
  });

  it("saving the same id again takes it out of the queue", async () => {
    const h = harness();
    h.queue.schedule(["a", "b"], "2 memories");
    h.queue.forget(["a"]);
    assert.equal(h.queue.isHidden("a"), false);
    await h.advance(8000);
    assert.deepEqual(h.calls, ["b"]);
    const only = h.queue.schedule(["c"], "c")!;
    h.queue.forget(["c"]);
    assert.equal(h.queue.undo(only.key), false, "an emptied batch is gone");
  });

  it("holding a toast stops the countdown, releasing resumes it", async () => {
    const h = harness();
    const batch = h.queue.schedule(["a"], "x")!;
    await h.advance(3000);
    h.queue.hold(batch.key);
    await h.advance(20_000);
    assert.deepEqual(h.calls, []);
    h.queue.release(batch.key);
    await h.advance(4999);
    assert.deepEqual(h.calls, []);
    await h.advance(1);
    assert.deepEqual(h.calls, ["a"]);
  });

  it("flushAll sends everything now, in order", async () => {
    const h = harness();
    h.queue.schedule(["a"], "x");
    h.queue.schedule(["b"], "y");
    await h.queue.flushAll();
    assert.deepEqual(h.calls, ["a", "b"]);
    assert.equal(h.settled.length, 2);
  });
});
