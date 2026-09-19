/**
 * Godkännandevyn för Claude-anslutning. Filip äger utseendet, Alfredo äger flödet.
 *
 * Fältnamn, action och felkoder är identiska med apps/api/app/oauth/authorize/page.tsx,
 * så Alfredo kan rendera den här komponenten där utan att ändra /oauth/approve.
 * Servern-komponent utan hooks, avsiktligt.
 */

export type OAuthApproveProps = {
  /** true när client_id, redirect_uri, PKCE m.m. är giltiga. */
  valid: boolean;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  /** OAuth resource (RFC 8707). ChatGPT skickar MCP-URL:en. Claude utelämnar den ofta. */
  resource?: string;
  email?: string;
  /** Feltext från ?error=… (redan översatt). */
  errorText?: string;
  /** "connected" | "denied" visar slutläge i stället för formuläret. */
  result?: "connected" | "denied";
  /** Var formuläret postas. Alfredos riktiga: /oauth/approve. */
  action?: string;
  /** Visas överst i mock-läge. */
  banner?: string;
};

// The keys are part of the contract with /oauth/approve. Only the text is English.
export const OAUTH_ERROR_TEXT: Record<string, string> = {
  credentials: "Wrong email or password.",
  config: "The server has no Supabase connection.",
  client: "The client could not be verified. Start Connect again in Claude, ChatGPT or Kimi.",
  invalid: "Invalid OAuth request. Open the address from the client, not directly.",
  resource: "Wrong MCP address in the OAuth request. Use the same /api/mcp you connected.",
  store: "Sign-in worked but the code could not be saved. Try again.",
  denied: "You denied access. The client cannot read or save your memories.",
};

const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-line-2";

/**
 * Neka = standard OAuth 2.0-avslag (RFC 6749 §4.1.2.1): tillbaka till klientens redirect_uri
 * med error=access_denied och samma state. Går inte via /oauth/approve, så Alfredos flöde
 * behöver inte ändras. redirect_uri är redan kontrollerad mot klienten innan vyn renderas.
 */
export function denyUrl(redirectUri: string, state: string): string {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "The user denied access.");
    if (state) url.searchParams.set("state", state);
    return url.toString();
  } catch {
    return "#";
  }
}

export function OAuthApproveView(p: OAuthApproveProps) {
  const action = p.action ?? "/oauth/approve";

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-12">
      {p.banner ? (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
          {p.banner}
        </p>
      ) : null}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Boringcontext</p>
        <h1 className="mt-1 text-2xl font-semibold">Give this client access to your memory?</h1>
      </div>

      {p.result === "connected" ? (
        <StatusBox tone="ok" title="Connected">
          The client can now save, search and update memories belonging to{" "}
          <strong>{p.email || "your account"}</strong>. You can close this window and go back to
          Claude, ChatGPT or Kimi.
        </StatusBox>
      ) : p.result === "denied" ? (
        <StatusBox tone="bad" title="Denied">
          {OAUTH_ERROR_TEXT.denied} Close the window and connect again if you change your mind.
        </StatusBox>
      ) : !p.valid ? (
        <StatusBox tone="bad" title="Invalid request">
          {p.errorText || OAUTH_ERROR_TEXT.invalid}
        </StatusBox>
      ) : (
        <>
          <ul className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
            <li className="py-1">
              The client may <strong>save</strong> facts, decisions, goals, deadlines, preferences
              and lessons.
            </li>
            <li className="py-1">
              The client may <strong>search and update</strong> your memories.
            </li>
            <li className="py-1">
              The client can <strong>never</strong> delete anything, and never sees another
              account&apos;s memories.
            </li>
          </ul>

          <form className="flex flex-col gap-3" method="post" action={action}>
            {p.errorText ? (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
                {p.errorText}
              </p>
            ) : null}
            <input type="hidden" name="client_id" value={p.clientId} />
            <input type="hidden" name="redirect_uri" value={p.redirectUri} />
            <input type="hidden" name="state" value={p.state} />
            <input type="hidden" name="code_challenge" value={p.codeChallenge} />
            <input type="hidden" name="code_challenge_method" value={p.codeChallengeMethod} />
            {p.resource ? <input type="hidden" name="resource" value={p.resource} /> : null}

            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                className={input}
                type="email"
                name="email"
                autoComplete="username"
                defaultValue={p.email ?? ""}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                className={input}
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <p className="text-xs text-ink-3">
              Sign in with the same account as the dashboard. Memories land on whichever account you
              sign in with here.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-88"
                type="submit"
              >
                Sign in and approve
              </button>
              <a
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-danger-soft"
                href={denyUrl(p.redirectUri, p.state)}
              >
                Deny
              </a>
            </div>
          </form>
        </>
      )}
    </main>
  );
}

function StatusBox({
  tone,
  title,
  children,
}: {
  tone: "ok" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  const look =
    tone === "ok"
      ? "border-line-2 bg-surface-2 text-ink"
      : "border-danger/40 bg-danger-soft text-ink";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${look}`}>
      <p className={`font-semibold ${tone === "ok" ? "text-ink" : "text-danger"}`}>{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
