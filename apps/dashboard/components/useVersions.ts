"use client";

import { useEffect, useState } from "react";
import { fetchVersions } from "@/lib/api";
import { isApiError, type MemoryVersion } from "@/lib/types";

export type VersionsState = {
  versions: MemoryVersion[] | null;
  error: { code?: string; message: string } | null;
};

/**
 * The history of the memory that is open, fetched once when it opens and
 * again when it changes (keyed on updated_at). Shared by the "Last change"
 * line and the History list, so opening History costs no second request.
 */
export function useVersions(memoryId: string | null, stamp: string | null, userId: string): VersionsState {
  const [state, setState] = useState<VersionsState & { key: string | null }>({ key: null, versions: null, error: null });
  const key = memoryId ? `${memoryId}@${stamp ?? ""}` : null;

  useEffect(() => {
    if (!memoryId || !key) return;
    let alive = true;
    void fetchVersions(memoryId, userId).then((result) => {
      if (!alive) return;
      setState(
        isApiError(result)
          ? { key, versions: null, error: result.error }
          : { key, versions: result, error: null },
      );
    });
    return () => {
      alive = false;
    };
  }, [memoryId, key, userId]);

  // An answer for another memory, or an older version of this one, is not shown.
  if (!key || state.key !== key) return { versions: null, error: null };
  return { versions: state.versions, error: state.error };
}
