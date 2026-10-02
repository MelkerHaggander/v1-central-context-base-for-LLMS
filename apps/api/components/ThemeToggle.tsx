"use client";

/**
 * Light or dark.
 *
 * v1.1 cycled System, Light, Dark behind one text button. On a dark OS that
 * meant the first click on "System" jumped to Light, and the click from Dark
 * back to System changed nothing on screen, which is why it felt broken
 * (Alfredo, "Ideer till Filips dashboard", point 5). Now the button always
 * flips what you see, shows what you will get, and fades instead of snapping.
 * Until the reader picks light or dark, the dashboard follows the computer.
 *
 * Stored per browser in localStorage and written to data-theme on <html>,
 * which both the CSS and the canvas read. The inline script in app/layout.tsx
 * applies it before first paint.
 */

import { useCallback, useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";
import { MoonIcon, SunIcon } from "./icons";
import { motionReduced } from "./useMotion";

type Resolved = "light" | "dark";

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode */
  }
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
}

function resolve(choice: ThemeChoice): Resolved {
  if (choice === "system") return systemDark() ? "dark" : "light";
  return choice;
}

/**
 * `origin` is where the click was. The new theme then spreads from that point
 * as a growing circle over the old one (a view transition), which is the one
 * big movement in the dashboard. Browsers without view transitions, and
 * reduced motion, get the short colour cross-fade instead.
 */
export function applyTheme(choice: ThemeChoice, origin?: { x: number; y: number }) {
  const root = document.documentElement;
  const commit = () => {
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* private mode: the choice holds until reload */
    }
    window.dispatchEvent(new Event("bc-theme"));
  };

  if (motionReduced()) {
    commit();
    return;
  }

  if (typeof document.startViewTransition === "function") {
    const x = origin?.x ?? window.innerWidth - 48;
    const y = origin?.y ?? 24;
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.classList.add("theme-reveal");
    const transition = document.startViewTransition(commit);
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
          { duration: 620, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
    transition.finished.finally(() => root.classList.remove("theme-reveal"));
    return;
  }

  // A short cross-fade on colours only, so the switch reads as one change and
  // not as the page flashing.
  root.classList.add("theme-fade");
  window.setTimeout(() => root.classList.remove("theme-fade"), 320);
  commit();
}

/** The middle of the control that was pressed, for keyboard presses that carry no pointer position. */
export function originOf(event: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const r = event.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Current choice and what it resolves to, kept in sync across every control. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  useEffect(() => {
    const sync = () => {
      const next = readChoice();
      setChoice(next);
      setResolved(resolve(next));
    };
    const id = window.setTimeout(sync, 0);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    window.addEventListener("bc-theme", sync);
    return () => {
      window.clearTimeout(id);
      media.removeEventListener("change", sync);
      window.removeEventListener("bc-theme", sync);
    };
  }, []);

  const set = useCallback((next: ThemeChoice, origin?: { x: number; y: number }) => applyTheme(next, origin), []);
  return { choice, resolved, set };
}

export function ThemeToggle() {
  const { resolved, set } = useTheme();
  const target: Resolved = resolved === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={(event) => set(target, originOf(event))}
      className="press grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
      title={`Switch to ${target} mode`}
      aria-label={`Switch to ${target} mode`}
    >
      {/* Keyed on the theme, so the new icon turns in. */}
      <span key={resolved} className="swap grid place-items-center">
        {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
      </span>
    </button>
  );
}
