"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteMemory, deleteMemoryOnUnload, session } from "@/lib/api";
import { DeleteQueue, type DeleteBatch, type DeleteOutcome } from "@/lib/delete-queue";
import { isApiError, type Memory } from "@/lib/types";

/**
 * Sign-out clears the cookie before this page unmounts, so deletes still
 * waiting would go out unauthenticated and be lost without a word. TopBar
 * calls this first; it sends every waiting delete and resolves when they have
 * all been answered.
 */
const beforeSignOut = new Set<() => Promise<void>>();

export async function flushDeletesBeforeSignOut(): Promise<void> {
  await Promise.all([...beforeSignOut].map((flush) => flush()));
}

export type DeleteQueueState = {
  /** Rows every view leaves out: waiting, being deleted, or deleted. */
  hidden: ReadonlySet<string>;
  /** Batches that can still be undone, newest last. */
  pending: DeleteBatch[];
  /** The last batch where something could not be deleted. */
  failure: DeleteOutcome | null;
  /** Hide these rows now; optional label overrides the default toast text. */
  request: (memories: readonly Memory[], label?: string) => void;
  undo: (key: number) => void;
  /** Hold / resume a toast's countdown while it is hovered or focused. */
  hold: (key: number) => void;
  release: (key: number) => void;
  /** The server saved these ids again: they must not be deleted. */
  forget: (ids: readonly string[]) => void;
  dismissFailure: () => void;
};

/**
 * One queue per signed-in account, held above the globe so a switch of space
 * neither cancels nor fires the deletes that are waiting. Closing the tab
 * sends them (keepalive). Signing out sends them first (TopBar awaits
 * flushDeletesBeforeSignOut). If another account has signed in meanwhile,
 * nothing is sent and the rows come back.
 */
export function useDeleteQueue(userId: string): DeleteQueueState {
  const [view, setView] = useState<{ hidden: ReadonlySet<string>; pending: DeleteBatch[] }>(() => ({
    hidden: new Set(),
    pending: [],
  }));
  const [failure, setFailure] = useState<DeleteOutcome | null>(null);

  // One queue for the life of this account's page. Lazy state, so it is built
  // once and never read from a ref during render.
  const [queue] = useState(() => {
    const q: DeleteQueue = new DeleteQueue({
      deleteOne: async (id) => {
        const result = await deleteMemory(id, userId);
        return { error: isApiError(result) ? result.error : null };
      },
      // The cookie may belong to someone else by now (another tab signed in).
      // Check right before sending, not after the server has acted.
      beforeBatch: async () => {
        const current = await session();
        return !("error" in current) && current.data?.id === userId;
      },
      onChange: () => setView({ hidden: q.hiddenIds(), pending: q.pending() }),
      onSettled: (outcome) => {
        if (outcome.failed.length > 0) setFailure(outcome);
      },
    });
    return q;
  });

  useEffect(() => {
    const onHide = () => queue.flushOnUnload(deleteMemoryOnUnload);
    const flush = () => queue.flushAll();
    window.addEventListener("pagehide", onHide);
    beforeSignOut.add(flush);
    return () => {
      window.removeEventListener("pagehide", onHide);
      beforeSignOut.delete(flush);
      // Unmounted for another reason (account switch, session hiccup): send
      // now. beforeBatch refuses them if the session is no longer this account.
      void queue.flushAll();
    };
  }, [queue]);

  const request = useCallback(
    (memories: readonly Memory[], label?: string) => {
      if (memories.length === 0) return;
      const text =
        label?.trim() ||
        (memories.length === 1 ? `"${memories[0].title}"` : `${memories.length} memories`);
      queue.schedule(
        memories.map((m) => m.id),
        text,
      );
    },
    [queue],
  );

  return {
    hidden: view.hidden,
    pending: view.pending,
    failure,
    request,
    undo: (key) => void queue.undo(key),
    hold: (key) => queue.hold(key),
    release: (key) => queue.release(key),
    forget: (ids) => queue.forget(ids),
    dismissFailure: () => setFailure(null),
  };
}
