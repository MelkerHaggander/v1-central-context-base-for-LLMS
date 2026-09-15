"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText, inputClass } from "@/components/ui";
import { login, session } from "@/lib/api";
import { bindTabUser, decideTabSession, getBoundTabUser, notifySessionChanged } from "@/lib/tab-session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  // Redan inloggad som samma konto som den här fliken -> listan.
  // Om cookien tillhör ett annat konto stannar vi här så minnen inte blandas.
  useEffect(() => {
    (async () => {
      const result = await session();
      if ("error" in result || !result.data) return;
      const decision = decideTabSession(getBoundTabUser(), result.data.id);
      if (decision.action === "mismatch") return;
      router.replace("/dashboard");
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await login(email, password);
    setBusy(false);
    if ("error" in result) {
      // T.ex. { error: { code: "INVALID_CREDENTIALS", message: "Fel mejl eller lösenord." } }
      setError(result.error);
      return;
    }
    bindTabUser(result.data.id);
    notifySessionChanged();
    router.replace("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Claude-minne</h1>
        <p className="mt-1 text-sm text-muted">
          Logga in med ditt förskapade konto. Ingen registrering i V1.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-post
          <input
            className={inputClass}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Lösenord
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <ErrorText code={error.code} message={error.message} /> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Loggar in…" : "Logga in"}
        </Button>
      </form>
    </main>
  );
}
