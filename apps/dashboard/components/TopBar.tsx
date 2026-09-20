"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/api";
import { displayApiError } from "@/lib/display-error";
import { clearBoundTabUser, notifySessionChanged } from "@/lib/tab-session";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "./ui";

export function TopBar({ email }: { email: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    setError(null);
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

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        pathname === href ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
      <span className="mr-1 text-sm font-semibold tracking-tight">Boringcontext</span>
      <nav className="flex gap-0.5">
        {link("/dashboard", "Memories")}
        {link("/connect", "Connect")}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <span className="hidden text-xs text-ink-3 sm:inline">{email}</span>
        <Button variant="ghost" onClick={onLogout} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </header>
  );
}
