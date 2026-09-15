"use client";

import { useEffect, useState } from "react";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";
import { CopyButton, ErrorText } from "@/components/ui";
import { CLAUDE_INSTRUCTIONS } from "@/lib/claude-instructions";

export function ConnectView({ url }: { url: string }) {
  const [resolvedUrl, setResolvedUrl] = useState(url);

  useEffect(() => {
    if (!url) setResolvedUrl(`${window.location.origin}/api/mcp`);
  }, [url]);

  return (
    <SessionGate>
      {(user) => (
        <>
          <TopBar email={user.email} />
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <h1 className="text-xl font-semibold">Anslut Claude till ditt minne</h1>
        <p className="mt-1 text-sm text-muted">
          Fyra steg. Inget installeras lokalt. Claude ansluter via fjärr-MCP och får bara se
          minnen som tillhör <strong>{user.email}</strong>.
        </p>

        <ol className="mt-6 flex flex-col gap-5">
          <Step n={1} title="Logga in här">
            Klart. Du är inloggad som {user.email}. Använd samma konto i nästa steg.
          </Step>

          <Step n={2} title="Kopiera MCP-adressen">
            {resolvedUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-line bg-background px-3 py-2 text-sm">
                  {resolvedUrl}
                </code>
                <CopyButton text={resolvedUrl} />
              </div>
            ) : (
              <ErrorText message="MCP-adressen saknas. Öppna sidan på Vercel-adressen, eller sätt NEXT_PUBLIC_MCP_URL." />
            )}
            <p className="mt-2 text-sm text-muted">
              I Claude Desktop: <em>Settings → Connectors → Add custom connector</em>. Klistra in
              adressen som fjärranslutning (Remote MCP server) och spara.
            </p>
          </Step>

          <Step n={3} title="Godkänn åtkomst">
            Klicka <em>Connect</em> på anslutningen i Claude. Ett fönster öppnas där du loggar in
            med <strong>samma konto</strong> som här och godkänner att Claude får spara och hämta
            dina minnen. Efteråt visar Claude anslutningen som ansluten.
          </Step>

          <Step n={4} title="Klistra in instruktionerna i Claude-projektet">
            <p className="mb-2 text-sm text-muted">
              Skapa ett projekt i Claude och lägg texten nedan som projektinstruktion, exakt som
              den står. Claude sparar och hämtar bara enligt instruktionerna, inte automatiskt
              från alla chattar.
            </p>
            <blockquote className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-background px-3 py-2 font-mono text-xs leading-relaxed">
              {CLAUDE_INSTRUCTIONS}
            </blockquote>
            <div className="mt-2">
              <CopyButton text={CLAUDE_INSTRUCTIONS} label="Kopiera instruktionerna" />
            </div>
          </Step>
        </ol>

        <section className="mt-8 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
          <h2 className="font-medium">Testa att det fungerar</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>Skriv till Claude: ”Kom ihåg att Projekt A ska lanseras den 15 oktober 2026.”</li>
            <li>Gå till fliken Minnen. Raden ska synas inom tio sekunder.</li>
            <li>Öppna en ny chatt och fråga: ”När ska Projekt A lanseras?”</li>
            <li>Be Claude ändra datumet. Samma rad ska uppdateras, inte en ny skapas.</li>
          </ol>
        </section>
      </main>
        </>
      )}
    </SessionGate>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-background">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-medium">{title}</h2>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </li>
  );
}
