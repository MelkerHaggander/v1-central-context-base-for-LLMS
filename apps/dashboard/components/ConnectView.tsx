"use client";

/**
 * Connect guide. The technical strings are load bearing and stay exactly as they
 * are: the MCP path, the /api/health keys, the Kimi command. Only the prose is
 * English now.
 *
 * There is no prompt to paste in V1.1. The server sends its instructions in
 * initialize.instructions, which is why step three says so out loud: people who
 * used V1 will look for the paste step.
 */

import { useEffect, useState } from "react";
import { SessionGate } from "@/components/SessionGate";
import { TopBar } from "@/components/TopBar";
import { CopyButton, ErrorText } from "@/components/ui";

export function ConnectView({ url }: { url: string }) {
  const [resolvedUrl, setResolvedUrl] = useState(url);

  useEffect(() => {
    if (url) return;
    // Deferred so the effect does not set state while rendering.
    const id = window.setTimeout(() => setResolvedUrl(`${window.location.origin}/api/mcp`), 0);
    return () => window.clearTimeout(id);
  }, [url]);

  return (
    <SessionGate>
      {(user) => (
        <>
          <TopBar email={user.email} />
          <main className="thin-scroll mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
            <h1 className="text-xl font-semibold tracking-tight">
              Connect Claude, ChatGPT, Grok or Kimi
            </h1>
            <p className="mt-1.5 text-sm text-ink-2">
              Three steps, and no project prompt to paste. The server tells the client how to use
              the memory. Only memories belonging to <strong>{user.email}</strong> are ever visible.
            </p>

            <ol className="mt-6 flex flex-col gap-5">
              <Step n={1} title="Sign in here">
                Done. You are signed in as {user.email}. Use the same account when you approve the
                connection.
              </Step>

              <Step n={2} title="Copy the MCP address">
                {resolvedUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="flex-1 break-all rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
                      {resolvedUrl}
                    </code>
                    <CopyButton text={resolvedUrl} />
                  </div>
                ) : (
                  <ErrorText message="The MCP address is missing. Open this page on the Vercel address, or set NEXT_PUBLIC_MCP_URL." />
                )}
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
                  <li>
                    Claude Desktop: Settings → Connectors → Add custom connector. Remote MCP server.
                  </li>
                  <li>
                    Grok (grok.com): New Connector → Custom → the same MCP address. The sign-in
                    should open by itself, as it does in Claude. If Grok only lists tools without
                    asking you to sign in, the deployment is too old:{" "}
                    <code className="text-xs">/api/health</code> should show{" "}
                    <code className="text-xs">grok: oauth-first</code>.
                  </li>
                  <li>
                    ChatGPT (web): Settings → Apps → create the app from the MCP address.
                    Authentication = Mixed, so initialize and list work without a key. Then a new
                    chat → Plus → Developer mode → switch the app on in that chat. If the tools are
                    missing, delete the app and create it again once{" "}
                    <code className="text-xs">/api/health</code> shows{" "}
                    <code className="text-xs">chatgpt: mixed-auth</code>.
                  </li>
                  <li>
                    Kimi Code:{" "}
                    <code className="text-xs">
                      kimi mcp add --transport http --auth oauth central-memory{" "}
                      {resolvedUrl || "https://YOUR-DOMAIN/api/mcp"}
                    </code>{" "}
                    then <code className="text-xs">kimi mcp auth central-memory</code>. Not tested
                    in V1.1.
                  </li>
                </ul>
                {isVercelPreviewMcp(resolvedUrl) ? (
                  <p className="mt-2 text-sm text-danger">
                    ChatGPT cannot use this preview address. Vercel&apos;s own sign-in page blocks
                    ChatGPT&apos;s servers. Use the production address for{" "}
                    <code className="text-xs">/api/mcp</code>, not a{" "}
                    <code className="text-xs">-git-</code> preview.
                  </p>
                ) : null}
              </Step>

              <Step n={3} title="Approve access, then just talk">
                The client opens a sign-in. Use the <strong>same account</strong> as here. Do not
                paste any instructions into a project: the MCP server sends them itself.
              </Step>
            </ol>

            <section className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
              <h2 className="font-medium">Check it without pasting a prompt</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
                <li>Say: &ldquo;We have decided to launch on 20 October.&rdquo;</li>
                <li>Open Memories. The dot and the row should be there.</li>
                <li>New chat: &ldquo;When are we launching?&rdquo; The client should search first.</li>
                <li>Change the date. The same row should update, not a duplicate appear.</li>
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
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-medium">{title}</h2>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </li>
  );
}
