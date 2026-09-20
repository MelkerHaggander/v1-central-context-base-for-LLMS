"use client";

import { useEffect, useState } from "react";

/**
 * Reads CSS custom properties so the canvas can paint with the same tokens as
 * the rest of the page. Canvas cannot use var(), so the values are resolved
 * once and then only when the theme actually changes: the toggle writes
 * data-theme on <html>, and the OS setting fires a media query change.
 */
export function useThemeTokens(names: readonly string[]): Record<string, string> {
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next: Record<string, string> = {};
      for (const name of names) next[name] = style.getPropertyValue(name).trim();
      setTokens(next);
    };

    read();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
    // names is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names.join(",")]);

  return tokens;
}
