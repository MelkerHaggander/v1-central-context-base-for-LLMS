import { pkceChallenge } from "@/lib/oauth/crypto";
import { exchangeAuthorizationCode, type ExchangedCode } from "@/lib/oauth/store";
import { issueMcpTokens, type IssuedTokens } from "@/lib/oauth/sessions";

export type AuthorizationCodeGrant =
  | { error: "invalid_grant" }
  | { issued: IssuedTokens };

export type AuthorizationCodeGrantDeps = {
  exchangeAuthorizationCode: typeof exchangeAuthorizationCode;
  issueMcpTokens: typeof issueMcpTokens;
  pkceChallenge: typeof pkceChallenge;
};

const defaultDeps: AuthorizationCodeGrantDeps = {
  exchangeAuthorizationCode,
  issueMcpTokens,
  pkceChallenge,
};

/**
 * Authorization-code grant after the HTTP layer has read the body.
 * PKCE is hashed here and sent to the database; the code is not consumed unless
 * the challenge matches in the same statement.
 */
export async function authorizationCodeGrant(
  params: Record<string, string>,
  deps: AuthorizationCodeGrantDeps = defaultDeps,
): Promise<AuthorizationCodeGrant> {
  const code = String(params.code ?? "");
  const redirectUri = String(params.redirect_uri ?? "");
  const clientId = String(params.client_id ?? "");
  const verifier = String(params.code_verifier ?? "");
  if (!code || !redirectUri || !clientId || !verifier) {
    return { error: "invalid_grant" };
  }

  const row: ExchangedCode | null = await deps.exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    codeChallenge: deps.pkceChallenge(verifier),
  });
  if (!row) return { error: "invalid_grant" };

  const issued = await deps.issueMcpTokens({
    userId: row.userId,
    supabaseAccess: row.supabaseAccess,
    supabaseRefresh: row.supabaseRefresh,
  });
  return { issued };
}
