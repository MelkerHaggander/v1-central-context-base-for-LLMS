"use client";

/**
 * Brand left, Memories and Connect in the middle, account on the right.
 *
 * Alfredo's point 3: the email and the Sign out button are gone from the bar.
 * A round avatar opens a menu with the account, the theme and signing out.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/api";
import { flushDeletesBeforeSignOut } from "./useDeleteQueue";
import { displayApiError } from "@/lib/display-error";
import { LEAVE_MS } from "@/lib/motion";
import { clearBoundTabUser, notifySessionChanged } from "@/lib/tab-session";
import type { ThemeChoice } from "@/lib/theme";
import { ThemeToggle, originOf, useTheme } from "./ThemeToggle";
import { useMotionSetting, usePresence } from "./useMotion";
import { Spinner, useSegmentThumb } from "./ui";

export function TopBar({ email }: { email: string }) {
  const pathname = usePathname();

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`press relative px-3 py-1.5 text-sm ${
          active ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
        }`}
      >
        {label}
        {active ? (
          <span aria-hidden className="grow-x absolute inset-x-3 -bottom-[11px] h-px bg-ink" />
        ) : null}
      </Link>
    );
  };

  // Same background as the page and no line under it: the bar belongs to the
  // view instead of sitting on top of it (Filip, 28 Sep).
  return (
    <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-bg px-3 py-2 sm:px-5">
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" aria-hidden className="size-5 shrink-0" />
        <span className="hidden truncate sm:inline">Boringcontext</span>
        <span className="sr-only sm:hidden">Boringcontext</span>
      </span>
      <nav className="flex items-center" aria-label="Main">
        {link("/dashboard", "Memories")}
        {link("/connect", "Connect")}
      </nav>
      <div className="flex items-center justify-end gap-1">
        <ThemeToggle />
        <AccountMenu email={email} />
      </div>
    </header>
  );
}

function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const menu = usePresence(open, LEAVE_MS.menu);
  const { resolved, set } = useTheme();
  const motion = useMotionSetting();
  const { box: themeBox, thumb: themeThumb } = useSegmentThumb(`${resolved}:${open}`);
  const { box: motionBox, thumb: motionThumb } = useSegmentThumb(`${motion.resolved}:${open}`);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onLogout() {
    setBusy(true);
    setError(null);
    // Deletes still inside their Undo window go out while the cookie is valid.
    await flushDeletesBeforeSignOut();
    const result = await logout();
    setBusy(false);
    if ("error" in result) {
      setError(displayApiError(result.error));
      return;
    }
    // Drop this tab's binding and tell the other tabs, so none of them keeps
    // showing an account that is no longer signed in.
    clearBoundTabUser();
    notifySessionChanged();
    router.replace("/");
  }

  const initial = (email.trim()[0] ?? "?").toUpperCase();
  // Only what you can see. A "System" option did nothing visible whenever the
  // computer already matched the current theme, which read as a dead button.
  // Until you pick one, the dashboard still follows the computer.
  const themes: Array<{ value: Exclude<ThemeChoice, "system">; label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${email}`}
        className="press grid size-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-ink hover:opacity-85"
      >
        {initial}
      </button>

      {menu.mounted ? (
        <div
          role="menu"
          inert={menu.leaving || undefined}
          className={`${menu.leaving ? "menu-out" : "menu-in"} absolute right-0 top-10 z-50 w-64 origin-top-right rounded-xl border border-line bg-surface p-1.5 shadow-xl`}
        >
          <div className="px-2.5 pb-2 pt-1.5">
            <p className="text-xs text-ink-3">Signed in as</p>
            <p className="truncate text-sm font-medium">{email}</p>
          </div>

          <div className="border-t border-line px-2.5 py-2.5">
            <p className="mb-1.5 text-xs text-ink-3">Theme</p>
            <div ref={themeBox} className="relative grid grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-0.5">
              <span ref={themeThumb} aria-hidden className="seg-thumb rounded-md bg-surface shadow-sm" />
              {themes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={resolved === t.value}
                  data-active={resolved === t.value}
                  onClick={(event) => set(t.value, originOf(event))}
                  className={`press relative rounded-md py-1 text-xs ${
                    resolved === t.value ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Full or reduced motion. Follows the computer until one is picked;
              a school computer can have animations off without the reader
              choosing that (lib/motion.ts). */}
          <div className="border-t border-line px-2.5 py-2.5">
            <p className="mb-1.5 text-xs text-ink-3">Motion</p>
            <div ref={motionBox} className="relative grid grid-cols-2 gap-0.5 rounded-lg bg-surface-2 p-0.5">
              <span ref={motionThumb} aria-hidden className="seg-thumb rounded-md bg-surface shadow-sm" />
              {(["full", "reduced"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={motion.resolved === value}
                  data-active={motion.resolved === value}
                  onClick={() => motion.set(value)}
                  className={`press relative rounded-md py-1 text-xs ${
                    motion.resolved === value ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {value === "full" ? "Full" : "Reduced"}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink active:bg-surface-3 disabled:opacity-50"
            >
              {busy ? <Spinner /> : null}
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
          {error ? <p className="fade-in px-2.5 pb-2 text-xs text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
