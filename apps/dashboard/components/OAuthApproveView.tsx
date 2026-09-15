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

export const OAUTH_ERROR_TEXT: Record<string, string> = {
  credentials: "Fel mejl eller lösenord.",
  config: "Servern saknar Supabase-koppling.",
  client: "Klienten kunde inte verifieras. Starta om Connect i Claude, ChatGPT eller Kimi.",
  invalid: "Ogiltig OAuth-begäran. Öppna adressen från klienten, inte direkt.",
  resource: "Fel MCP-adress i OAuth-begäran. Använd samma /api/mcp som du kopplade.",
  store: "Inloggningen gick igenom men koden kunde inte sparas. Försök igen.",
  denied: "Du nekade åtkomst. Klienten kan inte läsa eller spara dina minnen.",
};

const input =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-accent";

/**
 * Neka = standard OAuth 2.0-avslag (RFC 6749 §4.1.2.1): tillbaka till klientens redirect_uri
 * med error=access_denied och samma state. Går inte via /oauth/approve, så Alfredos flöde
 * behöver inte ändras. redirect_uri är redan kontrollerad mot klienten innan vyn renderas.
 */
export function denyUrl(redirectUri: string, state: string): string {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "Användaren nekade åtkomst.");
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
        <p className="rounded-md border border-line bg-accent-soft px-3 py-2 text-xs text-accent">
          {p.banner}
        </p>
      ) : null}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Claude-minne</p>
        <h1 className="mt-1 text-2xl font-semibold">Ge klienten åtkomst till ditt minne?</h1>
      </div>

      {p.result === "connected" ? (
        <StatusBox tone="ok" title="Ansluten">
          Klienten får nu spara, söka och uppdatera minnen som tillhör{" "}
          <strong>{p.email || "ditt konto"}</strong>. Du kan stänga det här fönstret och gå
          tillbaka till Claude, ChatGPT eller Kimi.
        </StatusBox>
      ) : p.result === "denied" ? (
        <StatusBox tone="bad" title="Nekad">
          {OAUTH_ERROR_TEXT.denied} Stäng fönstret och anslut igen om du ångrar
          dig.
        </StatusBox>
      ) : !p.valid ? (
        <StatusBox tone="bad" title="Ogiltig begäran">
          {p.errorText || OAUTH_ERROR_TEXT.invalid}
        </StatusBox>
      ) : (
        <>
          <ul className="rounded-md border border-line bg-panel px-4 py-3 text-sm">
            <li className="py-1">Klienten får <strong>spara</strong> fakta, beslut, mål, deadlines och preferenser.</li>
            <li className="py-1">Klienten får <strong>söka och uppdatera</strong> dina minnen.</li>
            <li className="py-1">Klienten ser <strong>aldrig</strong> andra kontons minnen.</li>
          </ul>

          <form className="flex flex-col gap-3" method="post" action={action}>
            {p.errorText ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
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
              E-post
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
              Lösenord
              <input
                className={input}
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <p className="text-xs text-muted">
              Logga in med samma konto som i dashboarden. Minnena hamnar på det konto du loggar in
              med här.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-background hover:opacity-90"
                type="submit"
              >
                Logga in och godkänn
              </button>
              <a
                className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-foreground hover:bg-danger-soft"
                href={denyUrl(p.redirectUri, p.state)}
              >
                Neka
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
      ? "border-accent/40 bg-accent-soft text-foreground"
      : "border-danger/40 bg-danger-soft text-foreground";
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${look}`}>
      <p className={`font-semibold ${tone === "ok" ? "text-accent" : "text-danger"}`}>{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
