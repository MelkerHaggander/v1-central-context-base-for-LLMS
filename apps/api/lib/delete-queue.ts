/**
 * Undo for deletes.
 *
 * The API has no trash: DELETE /api/memories/:id removes the row, and after
 * that /versions answers 404, so nothing in the dashboard can bring it back.
 * In a team any member may delete, bulk delete exists, and a memory that is
 * gone by mistake is context the AI silently loses. So a delete is held back:
 * the rows disappear from every view at once, a toast offers Undo, and the
 * DELETE requests only go out when the delay has passed.
 *
 * Rules:
 * - Batches run one after the other, one DELETE at a time, never in parallel
 *   (the same rule bulk delete had before). A row that fails comes back.
 * - Before a batch is sent, `beforeBatch` may refuse it (the session now
 *   belongs to another account). Refused rows come back, nothing is sent.
 * - The page going away (close, reload, back/forward cache) sends everything
 *   not yet sent at once with keepalive: the reader asked for these to go.
 * - Saving a memory with the same id again takes it out of the queue, since
 *   the server reuses the id of an existing subject on save.
 * - Hovering or focusing a toast holds its countdown (WCAG 2.2.1).
 *
 * No React here. test/delete-queue.test.ts drives it with fake timers.
 */

export const UNDO_DELAY_MS = 8000;

export type DeleteBatch = {
  key: number;
  ids: readonly string[];
  /** "Integration day" or "3 memories". What the toast says was deleted. */
  label: string;
};

export type DeleteOutcome = {
  batch: DeleteBatch;
  gone: string[];
  failed: string[];
  error: { code?: string; message: string } | null;
};

type TimerHandle = unknown;

export type DeleteQueueDeps = {
  delayMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  /** Deletes one row. Resolves with an error for a failure. */
  deleteOne: (id: string) => Promise<{ error: { code?: string; message: string } | null }>;
  /** Runs before each batch is sent. Resolve false to refuse it. */
  beforeBatch?: () => Promise<boolean>;
  /** Called after every change to what is pending or hidden. */
  onChange: () => void;
  /** Called once per batch when it has been sent, refused or dropped. */
  onSettled: (outcome: DeleteOutcome) => void;
};

type Waiting = { batch: DeleteBatch; timer: TimerHandle | null; dueAt: number; remaining: number };

export class DeleteQueue {
  private readonly delayMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly deps: DeleteQueueDeps;

  private readonly waiting = new Map<number, Waiting>();
  /** Fired, not yet requested. */
  private readonly unsent = new Set<string>();
  /** Requested, no answer yet. */
  private readonly inflight = new Set<string>();
  /** Deleted in this session. Stays hidden so a refresh cannot flash it back. */
  private readonly gone = new Set<string>();
  private chain: Promise<void> = Promise.resolve();
  private nextKey = 1;

  constructor(deps: DeleteQueueDeps) {
    this.deps = deps;
    this.delayMs = deps.delayMs ?? UNDO_DELAY_MS;
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Hide these rows now and delete them after the delay, unless undone. */
  schedule(ids: readonly string[], label: string): DeleteBatch | null {
    const fresh = [...new Set(ids)].filter((id) => !this.isHidden(id));
    if (fresh.length === 0) return null;
    const batch: DeleteBatch = { key: this.nextKey++, ids: fresh, label };
    const timer = this.setTimer(() => this.fire(batch.key), this.delayMs);
    this.waiting.set(batch.key, { batch, timer, dueAt: this.now() + this.delayMs, remaining: this.delayMs });
    this.deps.onChange();
    return batch;
  }

  /** Bring a waiting batch back. False when it already went out. */
  undo(key: number): boolean {
    const entry = this.waiting.get(key);
    if (!entry) return false;
    if (entry.timer !== null) this.clearTimer(entry.timer);
    this.waiting.delete(key);
    this.deps.onChange();
    return true;
  }

  /** Stop a batch's countdown while the reader is on its toast. */
  hold(key: number) {
    const entry = this.waiting.get(key);
    if (!entry || entry.timer === null) return;
    this.clearTimer(entry.timer);
    entry.timer = null;
    entry.remaining = Math.max(0, entry.dueAt - this.now());
  }

  /** Resume a held countdown with the time that was left, at least a second. */
  release(key: number) {
    const entry = this.waiting.get(key);
    if (!entry || entry.timer !== null) return;
    const ms = Math.max(1000, entry.remaining);
    entry.dueAt = this.now() + ms;
    entry.timer = this.setTimer(() => this.fire(key), ms);
  }

  /**
   * The server just saved one of these ids again (same subject reuses the
   * row), so it must not be deleted. Takes it out wherever it is not yet sent.
   */
  forget(ids: readonly string[]) {
    let changed = false;
    for (const id of ids) {
      if (this.unsent.delete(id)) changed = true;
      if (this.gone.delete(id)) changed = true;
    }
    for (const [key, entry] of this.waiting) {
      const keep = entry.batch.ids.filter((id) => !ids.includes(id));
      if (keep.length === entry.batch.ids.length) continue;
      changed = true;
      if (keep.length === 0) {
        if (entry.timer !== null) this.clearTimer(entry.timer);
        this.waiting.delete(key);
      } else {
        entry.batch = { ...entry.batch, ids: keep };
      }
    }
    if (changed) this.deps.onChange();
  }

  /** Batches that can still be undone, oldest first. */
  pending(): DeleteBatch[] {
    return [...this.waiting.values()].map((entry) => entry.batch);
  }

  isHidden(id: string): boolean {
    if (this.unsent.has(id) || this.inflight.has(id) || this.gone.has(id)) return true;
    for (const { batch } of this.waiting.values()) if (batch.ids.includes(id)) return true;
    return false;
  }

  /** Waiting, being deleted, or deleted in this session. Views leave these out. */
  hiddenIds(): Set<string> {
    const out = new Set<string>([...this.unsent, ...this.inflight, ...this.gone]);
    for (const { batch } of this.waiting.values()) for (const id of batch.ids) out.add(id);
    return out;
  }

  /** Send every waiting batch now, in order, and resolve when all have answered. */
  flushAll(): Promise<void> {
    for (const key of [...this.waiting.keys()]) this.fire(key);
    return this.chain;
  }

  /**
   * The page is going away: there is no time to wait for answers or to go one
   * at a time. Hands every id not yet confirmed (waiting, fired, or in flight;
   * a second DELETE of an in-flight id is a harmless 404) to `send`, which
   * should be a keepalive request, and treats them as gone. If the page comes
   * back from the back/forward cache, the toasts are gone and so are the rows.
   */
  flushOnUnload(send: (id: string) => void): void {
    const ids = new Set<string>([...this.unsent, ...this.inflight]);
    for (const entry of this.waiting.values()) {
      if (entry.timer !== null) this.clearTimer(entry.timer);
      for (const id of entry.batch.ids) ids.add(id);
    }
    this.waiting.clear();
    this.unsent.clear();
    for (const id of ids) {
      send(id);
      this.gone.add(id);
    }
    if (ids.size) this.deps.onChange();
  }

  private fire(key: number) {
    const entry = this.waiting.get(key);
    if (!entry) return;
    if (entry.timer !== null) this.clearTimer(entry.timer);
    this.waiting.delete(key);
    const { batch } = entry;
    for (const id of batch.ids) this.unsent.add(id);
    this.deps.onChange();
    this.chain = this.chain.then(() => this.run(batch));
  }

  private async run(batch: DeleteBatch) {
    const gone: string[] = [];
    const failed: string[] = [];
    let error: DeleteOutcome["error"] = null;

    const allowed = this.deps.beforeBatch ? await this.deps.beforeBatch().catch(() => false) : true;
    if (!allowed) {
      for (const id of batch.ids) if (this.unsent.delete(id)) failed.push(id);
      this.deps.onChange();
      this.deps.onSettled({
        batch,
        gone,
        failed,
        error: { code: "ACCOUNT_SWITCHED", message: "Another account is signed in now, so nothing was deleted." },
      });
      return;
    }

    for (const id of batch.ids) {
      // Forgotten (saved again) or already sent by an unload: skip.
      if (!this.unsent.delete(id)) continue;
      this.inflight.add(id);
      let result: { error: DeleteOutcome["error"] };
      try {
        result = await this.deps.deleteOne(id);
      } catch (cause) {
        result = { error: { message: cause instanceof Error ? cause.message : String(cause) } };
      }
      this.inflight.delete(id);
      // An unload already re-sent it with keepalive and counts it as gone.
      if (this.gone.has(id)) continue;
      if (result.error) {
        failed.push(id);
        error ??= result.error;
      } else {
        gone.push(id);
        this.gone.add(id);
      }
    }
    this.deps.onChange();
    this.deps.onSettled({ batch, gone, failed, error });
  }
}
