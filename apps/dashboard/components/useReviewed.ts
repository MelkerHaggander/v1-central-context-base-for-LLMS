"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { reviewKey, withReviewed } from "@/lib/review";
import type { Memory } from "@/lib/types";

/**
 * Which AI-saved memories this reader has looked at, per account and space,
 * in localStorage. It only decides what the review inbox lists; losing it
 * (private window, cleared storage) means a second look, never a lost memory.
 */
export function useReviewed(userId: string, spaceId: string): [ReadonlySet<string>, (memories: readonly Memory[]) => void] {
  const key = `bc-reviewed:${userId}:${spaceId}`;
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        setKeys(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
      } catch {
        setKeys([]);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [key]);

  const mark = useCallback(
    (memories: readonly Memory[]) => {
      if (memories.length === 0) return;
      setKeys((current) => {
        const next = withReviewed(current, memories.map(reviewKey));
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage blocked: the review holds for this page only */
        }
        return next;
      });
    },
    [key],
  );

  const set = useMemo(() => new Set(keys), [keys]);
  return [set, mark];
}
