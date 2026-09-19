"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button, ErrorText, inputClass } from "@/components/ui";
import { login, session } from "@/lib/api";
import { bindTabUser, notifySessionChanged } from "@/lib/tab-session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  // Already signed in: straight to the globe.
  useEffect(() => {
    (async () => {
      const result = await session();
      if (!("error" in result) && result.data) router.replace("/dashboard");
    })();
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // Bind this tab to the account that just signed in, and tell the other tabs,
    // so two accounts can never be shown side by side in one browser.
    bindTabUser(result.data.id);
    notifySessionChanged();
    router.replace("/dashboard");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-7 px-5 pb-16">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Boringcontext</h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Your own memory for Claude, ChatGPT and Grok. Sign in to see everything they have
            remembered, and to change or delete any of it.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              className={inputClass}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <ErrorText code={error.code} message={error.message} /> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-xs text-ink-3">
          Accounts are created by hand. There is no public sign-up.
        </p>
      </main>
    </div>
  );
}
