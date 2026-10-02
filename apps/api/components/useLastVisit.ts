"use client";

import { useEffect, useState } from "react";

/**
 * When this reader last opened this space, per browser.
 *
 * The value returned is the previous visit, read once per page load and kept,
 * so "changed since your last visit" stays put while you look, also across a
 * switch to the other space and back. The new mark is written when the tab is
 * hidden or closed, which is when a visit ends.
 *
 * Per browser in localStorage on purpose: there is no server field for it, and
 * it is a convenience, not a record. If storage is blocked there is simply no
 * "since last visit" line, and the 24 hour marker still works.
 */
const previous = new Map<string, string | null>();

function readOnce(key: string): string | null {
  if (!previous.has(key)) {
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch {
      value = null;
    }
    previous.set(key, value);
  }
  return previous.get(key) ?? null;
}

export function useLastVisit(userId: string, spaceId: string): string | null {
  const key = `bc-last-visit:${userId}:${spaceId}`;
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    const read = window.setTimeout(() => setSince(readOnce(key)), 0);

    const mark = () => {
      readOnce(key);
      try {
        localStorage.setItem(key, new Date().toISOString());
      } catch {
        /* blocked storage: no last-visit line */
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") mark();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", mark);
    return () => {
      window.clearTimeout(read);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", mark);
      mark();
    };
  }, [key]);

  return since;
}
