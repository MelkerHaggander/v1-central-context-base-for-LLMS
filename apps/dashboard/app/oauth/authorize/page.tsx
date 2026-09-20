// MOCK av /oauth/authorize. Riktiga vyn ligger i apps/api (Alfredo) och postar till /oauth/approve.
// Den här sidan använder samma komponent och samma fältnamn, med simulerat godkännande.
import { OAUTH_ERROR_TEXT, OAuthApproveView } from "@/components/OAuthApproveView";

export const dynamic = "force-dynamic";

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const str = (key: string) => String(params[key] ?? "");

  const clientId = str("client_id");
  const redirectUri = str("redirect_uri");
  const codeChallenge = str("code_challenge");
  const method = str("code_challenge_method") || "S256";
  const errorCode = str("error");
  const resultRaw = str("result");
  const result = resultRaw === "connected" || resultRaw === "denied" ? resultRaw : undefined;

  // Mocken kräver bara att fälten finns. Alfredos riktiga sida verifierar klienten i sin store.
  const valid = Boolean(clientId && redirectUri && codeChallenge && method === "S256");

  return (
    <OAuthApproveView
      valid={valid}
      clientId={clientId}
      redirectUri={redirectUri}
      state={str("state")}
      codeChallenge={codeChallenge}
      codeChallengeMethod={method}
      resource={str("resource") || undefined}
      email={str("email")}
      errorText={OAUTH_ERROR_TEXT[errorCode] ?? (errorCode ? "Could not approve access." : undefined)}
      result={result}
      banner="Simulated approval (mock). The real OAuth against Supabase lives in apps/api."
    />
  );
}
