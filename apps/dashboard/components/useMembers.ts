"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMembers, isMissingEndpoint } from "@/lib/api";
import { isApiError, type Member, type Space } from "@/lib/types";

export type MembersState = {
  members: Member[] | null;
  /** The server has no members endpoint yet (proposal not built). Not an error. */
  missing: boolean;
  error: { code?: string; message: string } | null;
  reload: () => Promise<void>;
  /** user_id -> email, for "who changed this" in the history. */
  people: ReadonlyMap<string, string>;
  /**
   * Whether the server has the proposed team endpoints at all. null until the
   * first answer. The team buttons only show on true, so production never
   * offers a button that leads to "not on the server yet".
   */
  supported: boolean | null;
};

/**
 * Who is in the space being shown. Asked for personal spaces too (the answer is
 * just you): it is the one cheap way to learn whether the server has the team
 * endpoints before offering buttons for them. Against today's API the endpoint
 * does not exist, which reads as `missing`, and the history falls back to
 * "A teammate (id)" exactly as before.
 */
/**
 * Whether the server has the team endpoints does not change between spaces,
 * so remember the last answer for this page load. Without it the team buttons
 * vanish and come back on every switch while the probe is out.
 */
let lastKnownSupport: boolean | null = null;

export function useMembers(space: Space, userId: string): MembersState {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const result = await fetchMembers(space.id, userId);
    if (!alive.current) return;
    if (isApiError(result)) {
      if (isMissingEndpoint(result.error)) {
        lastKnownSupport = false;
        setMissing(true);
        setError(null);
      } else {
        setError(result.error);
      }
      return;
    }
    lastKnownSupport = true;
    setMissing(false);
    setError(null);
    setMembers(result);
  }, [space.id, userId]);

  useEffect(() => {
    alive.current = true;
    const id = window.setTimeout(() => void reload(), 0);
    return () => {
      alive.current = false;
      window.clearTimeout(id);
    };
  }, [reload]);

  const people = useMemo<ReadonlyMap<string, string>>(
    () => new Map((members ?? []).map((m) => [m.user_id, m.email])),
    [members],
  );

  const supported = missing ? false : members ? true : lastKnownSupport;

  return { members, missing, error, reload, people, supported };
}
