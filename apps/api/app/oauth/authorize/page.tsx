import { headers } from "next/headers";
import { OAuthApproveView, OAUTH_ERROR_TEXT } from "@/components/OAuthApproveView";
import { resourceAllowed } from "@/lib/oauth/resource";
import { getClient, redirectAllowed } from "@/lib/oauth/store";
import { publicOrigin } from "@/lib/oauth/urls";

export const dynamic = "force-dynamic";

async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost";
  const proto = h.get("x-forwarded-proto") || "https";
  return publicOrigin(
    new Request(`${proto}://${host}/oauth/authorize`, {
      headers: {
        "x-forwarded-host": host,
        "x-forwarded-proto": proto,
      },
    }),
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = String(params.client_id ?? "");
  const redirectUri = String(params.redirect_uri ?? "");
  const state = String(params.state ?? "");
  const codeChallenge = String(params.code_challenge ?? "");
  const method = String(params.code_challenge_method ?? "S256");
  const email = String(params.email ?? "");
  const resource = String(params.resource ?? "");
  const errorCode = String(params.error ?? "");
  const origin = await requestOrigin();
  const resourceOk = resourceAllowed(origin, resource);
  const errorText =
    OAUTH_ERROR_TEXT[errorCode] ??
    (!resourceOk
      ? OAUTH_ERROR_TEXT.resource
      : errorCode
        ? "Could not approve access."
        : "");

  const client = clientId ? await getClient(clientId) : null;
  const ok = Boolean(
    client &&
      redirectAllowed(client, redirectUri) &&
      method === "S256" &&
      codeChallenge &&
      resourceOk,
  );

  return (
    <OAuthApproveView
      valid={ok}
      clientId={clientId}
      redirectUri={redirectUri}
      state={state}
      codeChallenge={codeChallenge}
      codeChallengeMethod={method}
      resource={resource || undefined}
      email={email || undefined}
      errorText={errorText || undefined}
      action="/oauth/approve"
    />
  );
}
