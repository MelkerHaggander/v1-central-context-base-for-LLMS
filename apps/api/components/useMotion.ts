"use client";

/**
 * The hooks behind lib/motion.ts: keeping something on screen while it
 * animates out, and the Full / Reduced choice.
 *
 * React removes an element the moment its state says so, which is why things
 * used to vanish. These hooks keep the last value around for the length of
 * the leave animation, and say that it is leaving, so the CSS can play it.
 */

import { useCallback, useEffect, useState } from "react";
import { MOTION_KEY, type MotionChoice } from "@/lib/motion";

/**
 * The previous value, for `ms` after `value` changes; otherwise null.
 * A panel that closes renders its last kind from this while it slides out.
 */
export function useTrailing<T>(value: T, ms: number): T | null {
  const [prev, setPrev] = useState(value);
  const [trail, setTrail] = useState<{ value: T } | null>(null);

  // Adjusting state while rendering, the pattern React documents for
  // "storing information from previous renders": no effect, no extra frame.
  if (!Object.is(value, prev)) {
    setPrev(value);
    setTrail({ value: prev });
  }

  useEffect(() => {
    if (!trail) return;
    const id = window.setTimeout(() => setTrail(null), ms);
    return () => window.clearTimeout(id);
  }, [trail, ms]);

  if (!trail || Object.is(trail.value, value)) return null;
  return trail.value;
}

/** Open or closed, kept mounted while it closes. */
export function usePresence(open: boolean, ms: number): { mounted: boolean; leaving: boolean } {
  const wasOpen = useTrailing(open, ms) === true;
  return { mounted: open || wasOpen, leaving: !open && wasOpen };
}

export type Presence<T> = { item: T; key: string; leaving: boolean };

/**
 * A list that lets removed rows leave: a row that disappears from `items`
 * stays where it was, marked leaving, for `ms`. A row that comes back (Undo)
 * is simply live again. Keys, not array identity, decide what changed, so an
 * array rebuilt on every render is fine.
 */
export function usePresenceList<T>(items: readonly T[], keyOf: (item: T) => string, ms: number): Presence<T>[] {
  const signature = items.map(keyOf).join("\u0000");
  const [prev, setPrev] = useState<{ signature: string; items: readonly T[] }>({ signature, items });
  const [gone, setGone] = useState<Array<{ item: T; key: string; after: string | null; wave: number }>>([]);
  const [wave, setWave] = useState(0);

  if (signature !== prev.signature) {
    const live = new Set(items.map(keyOf));
    const next = wave + 1;
    const leaving = prev.items.flatMap((item, i) => {
      const key = keyOf(item);
      if (live.has(key)) return [];
      return [{ item, key, after: i > 0 ? keyOf(prev.items[i - 1]) : null, wave: next }];
    });
    setPrev({ signature, items });
    setWave(next);
    setGone((old) => [
      ...old.filter((g) => !live.has(g.key) && !leaving.some((l) => l.key === g.key)),
      ...leaving,
    ]);
  }

  useEffect(() => {
    if (gone.length === 0) return;
    const id = window.setTimeout(() => setGone((old) => old.filter((g) => g.wave > wave)), ms);
    return () => window.clearTimeout(id);
  }, [gone.length, wave, ms]);

  const out: Presence<T>[] = items.map((item) => ({ item, key: keyOf(item), leaving: false }));
  for (const g of gone) {
    if (out.some((row) => row.key === g.key)) continue;
    // Right after the row it used to follow; at the end if that one is gone too.
    let at = 0;
    if (g.after !== null) {
      const i = out.findIndex((row) => row.key === g.after);
      at = i === -1 ? out.length : i + 1;
    }
    out.splice(at, 0, { item: g.item, key: g.key, leaving: true });
  }
  return out;
}

/* ------------------------------ the setting ------------------------------ */

function systemReduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readMotion(): MotionChoice {
  try {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored === "full" || stored === "reduced") return stored;
  } catch {
    /* private mode */
  }
  const attr = document.documentElement.getAttribute("data-motion");
  return attr === "full" || attr === "reduced" ? attr : "system";
}

/** True when movement should be left out: the reader's choice, else the computer's. */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return false;
  const choice = readMotion();
  return choice === "system" ? systemReduced() : choice === "reduced";
}

export function applyMotion(choice: MotionChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", choice);
  try {
    if (choice === "system") localStorage.removeItem(MOTION_KEY);
    else localStorage.setItem(MOTION_KEY, choice);
  } catch {
    /* private mode: holds until reload */
  }
  window.dispatchEvent(new Event("bc-motion"));
}

/** What motion resolves to now, in sync across controls and with the OS setting. */
export function useMotionSetting() {
  const [resolved, setResolved] = useState<"full" | "reduced">("full");

  useEffect(() => {
    const sync = () => setResolved(motionReduced() ? "reduced" : "full");
    const id = window.setTimeout(sync, 0);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", sync);
    window.addEventListener("bc-motion", sync);
    return () => {
      window.clearTimeout(id);
      media.removeEventListener("change", sync);
      window.removeEventListener("bc-motion", sync);
    };
  }, []);

  const set = useCallback((next: MotionChoice) => applyMotion(next), []);
  return { resolved, set };
}
