"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSpaces } from "@/lib/api";
import { orderSpaces, pickSpace, spaceLabel } from "@/lib/insights";
import { isApiError, type Space } from "@/lib/types";

export type SpacesState = {
  spaces: Space[];
  active: Space | null;
  /** undefined while the first request is out. */
  ready: boolean;
  error: { code?: string; message: string } | null;
  choose: (spaceId: string) => void;
  retry: () => void;
  /** Refetch, then show `spaceId` if it is in the new list (after create), or personal (after leaving). */
  reload: (spaceId?: string) => Promise<void>;
  /** A rename answered by the server: show it without a refetch. */
  patch: (space: Space) => void;
  /** Set when a reload finds that a space the reader was looking at is gone. */
  notice: string | null;
  dismiss: () => void;
};

const key = (userId: string) => `bc-space:${userId}`;

function remembered(userId: string): string | null {
  try {
    return sessionStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

function remember(userId: string, spaceId: string) {
  try {
    sessionStorage.setItem(key(userId), spaceId);
  } catch {
    /* private mode: the switch still works, it just is not kept on reload */
  }
}

/**
 * The spaces this account is a member of, and which one the globe shows.
 *
 * GET /api/spaces decides the list from the session (Alfredo PR #40). The
 * choice is per tab, in sessionStorage, because it only steers the globe: the
 * switch never reaches MCP, and a chat keeps saving to personal whatever this
 * tab shows (Backend features, "Växlaren styr bara globen").
 */
export function useSpaces(userId: string): SpacesState {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);
  const known = useRef<Space[]>([]);
  // Only the newest load may write. A click in the switcher while a load is
  // out wins over that load's `prefer`, so a slow refetch never yanks the
  // reader away from the space they just picked.
  const loadSeq = useRef(0);
  const chooseSeq = useRef(0);

  const load = useCallback(async (prefer?: string) => {
    const mine = ++loadSeq.current;
    const choseBefore = chooseSeq.current;
    const result = await fetchSpaces(userId);
    if (!alive.current || mine !== loadSeq.current) return;
    const wanted = chooseSeq.current === choseBefore ? prefer : undefined;
    setReady(true);
    if (isApiError(result)) {
      setError(result.error);
      return;
    }
    if (result.length === 0) {
      setError({ code: "NO_SPACES", message: "Your account is not in any space yet." });
      setSpaces([]);
      return;
    }
    setError(null);
    // Removed from a team by someone else: say so, instead of just jumping.
    const lost = prefer ? known.current.find((s) => s.id === prefer && !result.some((r) => r.id === prefer)) : undefined;
    if (lost) setNotice(`You are no longer a member of ${spaceLabel(lost)}.`);
    known.current = orderSpaces(result);
    setSpaces(known.current);
    setActiveId((current) => {
      const next = pickSpace(result, wanted ?? current ?? remembered(userId))?.id ?? null;
      if (next) remember(userId, next);
      return next;
    });
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    const start = window.setTimeout(() => void load(), 0);
    return () => {
      alive.current = false;
      window.clearTimeout(start);
    };
  }, [load]);

  const choose = useCallback(
    (spaceId: string) => {
      if (!spaces.some((s) => s.id === spaceId)) return;
      chooseSeq.current += 1;
      remember(userId, spaceId);
      setActiveId(spaceId);
    },
    [spaces, userId],
  );

  return {
    spaces,
    active: spaces.find((s) => s.id === activeId) ?? null,
    ready,
    error,
    choose,
    retry: () => void load(),
    reload: (spaceId?: string) => load(spaceId ?? ""),
    patch: (space: Space) => {
      // A load that left before the rename would bring the old name back.
      loadSeq.current += 1;
      known.current = orderSpaces(known.current.map((s) => (s.id === space.id ? { ...s, ...space } : s)));
      setSpaces(known.current);
    },
    notice,
    dismiss: () => setNotice(null),
  };
}
