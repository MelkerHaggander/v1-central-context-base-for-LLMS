"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { session } from "@/lib/api";
import { displayApiError } from "@/lib/display-error";
import {
  bindTabUser,
  clearBoundTabUser,
  decideTabSession,
  getBoundTabUser,
  subscribeSessionChanged,
} from "@/lib/tab-session";
import type { SessionUser } from "@/lib/types";

/**
 * Cookie-sessionen är per webbläsare. Tab-låset är per flik (sessionStorage).
 * Om ett annat konto loggar in i en annan flik visar den här fliken inga minnen.
 */
export function useSession() {
  const router = useRouter();
  const alive = useRef(true);
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    const result = await session();
    if (!alive.current) return;
    if ("error" in result) {
      setError(displayApiError(result.error));
      setUser(null);
      setIncoming(null);
      return;
    }
    if (result.data === null) {
      clearBoundTabUser();
      setIncoming(null);
      setUser(null);
      router.replace("/");
      return;
    }

    const decision = decideTabSession(getBoundTabUser(), result.data.id);
    if (decision.action === "bind") {
      bindTabUser(result.data.id);
      setError(null);
      setIncoming(null);
      setUser(result.data);
      return;
    }
    if (decision.action === "ok") {
      setError(null);
      setIncoming(null);
      setUser(result.data);
      return;
    }

    setError(null);
    setUser(null);
    setIncoming(result.data);
  }, [router]);

  useEffect(() => {
    alive.current = true;
    // Deferred by a tick so the effect starts the check instead of setting state
    // during render. Pre-existing lint error on integration/v1.1; same fix as the
    // other hooks in this branch.
    const start = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeSessionChanged(() => {
      void refresh();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    return () => {
      alive.current = false;
      window.clearTimeout(start);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const continueAsIncoming = useCallback(() => {
    if (!incoming) return;
    bindTabUser(incoming.id);
    setUser(incoming);
    setIncoming(null);
  }, [incoming]);

  return { user, error, incoming, continueAsIncoming };
}
