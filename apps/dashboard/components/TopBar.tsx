"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/api";
import { clearBoundTabUser, notifySessionChanged } from "@/lib/tab-session";
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
      setError(result.error.message);
      return;
    }
    clearBoundTabUser();
    notifySessionChanged();
    // { data: { success: true } } -> tillbaka till inloggning.
    router.replace("/");
  }

  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${
        pathname === href ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <header className="border-b border-line bg-panel">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <span className="mr-2 font-semibold">Claude-minne</span>
        <nav className="flex gap-1">
          {link("/dashboard", "Minnen")}
          {link("/anslut", "Anslut Claude")}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted">{email}</span>
          <Button variant="ghost" onClick={onLogout} disabled={busy}>
            {busy ? "Loggar ut…" : "Logga ut"}
          </Button>
        </div>
        {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
      </div>
    </header>
  );
}
