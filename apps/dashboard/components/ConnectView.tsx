"use client";

import { useEffect, useState } from "react";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";
import { CopyButton, ErrorText } from "@/components/ui";

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
            <h1 className="text-xl font-semibold">Anslut Claude, ChatGPT, Grok eller Kimi</h1>
            <p className="mt-1 text-sm text-muted">
              Tre steg. Ingen projektprompt att klistra in. Servern talar om för klienten hur
              minnet ska användas. Bara minnen som tillhör <strong>{user.email}</strong> syns.
            </p>

            <ol className="mt-6 flex flex-col gap-5">
              <Step n={1} title="Logga in här">
                Klart. Du är inloggad som {user.email}. Använd samma konto när du godkänner
                anslutningen.
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
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  <li>
                    Claude Desktop: Settings → Connectors → Add custom connector. Fjärranslutning
                    (Remote MCP).
                  </li>
                  <li>
                    Grok (grok.com): New Connector → Custom → samma MCP-adress. Inloggningen ska
                    öppnas av sig själv (som i Claude). Om Grok bara listar verktyg utan login är
                    deployn för gammal — <code className="text-xs">/api/health</code> ska visa{" "}
                    <code className="text-xs">grok: oauth-first</code>.
                  </li>
                  <li>
                    ChatGPT (webben): Settings → Apps → skapa appen från MCP-adressen. Authentication
                    = Mixed (initialize/list utan nyckel). Sedan ny chatt → Plus → Developer mode →
                    slå på appen i just den chatten. Om verktygen saknas: ta bort appen och skapa om
                    den efter att <code className="text-xs">/api/health</code> visar{" "}
                    <code className="text-xs">chatgpt: mixed-auth</code>.
                  </li>
                  <li>
                    Kimi Code:{" "}
                    <code className="text-xs">
                      kimi mcp add --transport http --auth oauth central-memory {resolvedUrl || "https://DIN-DOMÄN/api/mcp"}
                    </code>
                    {" "}sedan{" "}
                    <code className="text-xs">kimi mcp auth central-memory</code>.
                  </li>
                </ul>
                {isVercelPreviewMcp(resolvedUrl) ? (
                  <p className="mt-2 text-sm text-red-700">
                    ChatGPT kan inte använda den här preview-adressen. Vercel-inloggning stoppar
                    ChatGPT:s servrar. Klistra in{" "}
                    <code className="text-xs">https://v1-alfredo-experiment.vercel.app/api/mcp</code>
                    {" "}efter att den deploymenten är Production på experiment-Verceln.
                  </p>
                ) : null}
              </Step>

              <Step n={3} title="Godkänn åtkomst och börja chatta">
                Klienten öppnar inloggning. Logga in med <strong>samma konto</strong> som här.
                Klistra inte in instruktioner i ett projekt. MCP-servern skickar dem själv.
              </Step>
            </ol>

            <section className="mt-8 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
              <h2 className="font-medium">Testa utan inklistrad prompt</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                <li>Skriv: ”Vi har beslutat att lansera den 20 oktober.”</li>
                <li>Gå till fliken Minnen. Raden ska synas.</li>
                <li>Ny chatt: ”När ska vi lansera?” Klienten ska söka själv.</li>
                <li>Ändra datumet. Samma rad ska uppdateras, inte en dubblett.</li>
              </ol>
            </section>
          </main>
        </>
      )}
    </SessionGate>
  );
}

function isVercelPreviewMcp(url: string) {
  try {
    return new URL(url).hostname.includes("-git-");
  } catch {
    return false;
  }
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
