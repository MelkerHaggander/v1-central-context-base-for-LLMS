import { releaseMcpTokens, type ReleasedMcpTokens } from "@/lib/oauth/store";
import { mcpClientExpiresIn, type IssuedTokens } from "@/lib/oauth/sessions";

export type AuthorizationCodeGrant =
  | { error: "invalid_grant" }
  | { issued: IssuedTokens };

export type AuthorizationCodeGrantDeps = {
  releaseMcpTokens: typeof releaseMcpTokens;
  expiresIn: () => number;
};

const defaultDeps: AuthorizationCodeGrantDeps = {
  releaseMcpTokens,
  expiresIn: () => mcpClientExpiresIn(),
};

/**
 * Authorization-code grant after the HTTP layer has read the body.
 * The database hashes the verifier. A mismatch does not consume the code.
 * MCP tokens were created when the user approved, so this step does not need service_role.
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

  const released: ReleasedMcpTokens | null = await deps.releaseMcpTokens({
    code,
    clientId,
    redirectUri,
    codeVerifier: verifier,
  });
  if (!released) return { error: "invalid_grant" };

  return {
    issued: {
      access_token: released.access_token,
      refresh_token: released.refresh_token,
      expires_in: deps.expiresIn(),
      supabase_access: "",
    },
  };
}
