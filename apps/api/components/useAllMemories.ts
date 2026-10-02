"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAllMemories } from "@/lib/api";
import { isApiError, type Memory } from "@/lib/types";

const REFRESH_MS = 15_000;

export type AllMemoriesState = {
  memories: Memory[];
  /** False when the page ceiling cut the walk short. The view must say so. */
  complete: boolean;
  loading: boolean;
  /** True only for the very first load, so a refetch never flashes a skeleton. */
  first: boolean;
  error: { code?: string; message: string } | null;
  fetchedAt: Date | null;
  refresh: () => void;
  /** Apply a local change straight away, then let the next fetch confirm it. */
  apply: (change: (rows: Memory[]) => Memory[]) => void;
};

/**
 * Every memory the account has, kept fresh.
 *
 * The globe needs all of them at once, which the contract only allows by walking
 * pages of 50 (see fetchAllMemories). That makes a refresh more expensive than
 * V1's single page, so it runs every 15 seconds instead of 10, only while the tab
 * is visible, and never twice at the same time.
 *
 * UNAUTHENTICATED is not handled here. SessionGate owns that: it polls the
 * session and moves the reader to the login page.
 */
export function useAllMemories(userId: string, spaceId: string): AllMemoriesState {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(false);
  const [first, setFirst] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const inFlight = useRef(false);
  // Set when a local change or a refresh request arrives while a fetch is
  // out. That fetch's answer may predate the change, so it is thrown away and
  // one more fetch runs, instead of snapping a just-saved row back.
  const again = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    setLoading(true);

    let result: Awaited<ReturnType<typeof fetchAllMemories>>;
    do {
      again.current = false;
      // v1.2: GET /api/memories answers 400 INVALID_SPACE without space_id.
      result = await fetchAllMemories({ expectedUserId: userId, space_id: spaceId });
    } while (again.current && alive.current);

    inFlight.current = false;
    if (!alive.current) return;
    setLoading(false);
    setFirst(false);

    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    setError(null);
    setMemories(result.memories);
    setComplete(result.complete);
    setFetchedAt(new Date());
  }, [userId, spaceId]);

  useEffect(() => {
    alive.current = true;
    // Deferred by a tick: the effect starts the fetch, it does not set state itself.
    const start = window.setTimeout(() => void load(), 0);

    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive.current = false;
      window.clearTimeout(start);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const apply = useCallback((change: (rows: Memory[]) => Memory[]) => {
    setMemories((rows) => change(rows));
    if (inFlight.current) again.current = true;
  }, []);

  return {
    memories,
    complete,
    loading,
    first,
    error,
    fetchedAt,
    refresh: () => void load(),
    apply,
  };
}
