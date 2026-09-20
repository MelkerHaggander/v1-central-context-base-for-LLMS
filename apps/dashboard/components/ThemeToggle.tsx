"use client";

/**
 * Light, dark, or whatever the system says. Stored per browser in localStorage
 * and written to data-theme on <html>, which both the CSS and the canvas read.
 * The inline script in app/layout.tsx applies the stored choice before first
 * paint, so there is no flash of the wrong theme.
 */

import { useEffect, useState } from "react";
import { THEME_KEY, type ThemeChoice } from "@/lib/theme";

type Choice = ThemeChoice;

const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Choice, string> = { system: "System", light: "Light", dark: "Dark" };

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: the choice just does not persist */
  }
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(THEME_KEY);
        if (stored === "light" || stored === "dark") setChoice(stored);
      } catch {
        /* private mode */
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const next = NEXT[choice];
        setChoice(next);
        apply(next);
      }}
      className="rounded-lg px-2 py-1.5 text-xs text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      title="Switch between system, light and dark"
    >
      {LABEL[choice]}
    </button>
  );
}
