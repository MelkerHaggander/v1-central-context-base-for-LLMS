import { createSupabaseAdminClient, createSupabaseAnonClient, createSupabaseUserClient } from "@/lib/supabase/clients";
import { fetchClientMetadata } from "./client-metadata";
import { redirectAllowed as uriAllowed } from "./redirect";

export type OAuthClient = {
  client_id: string;
  redirect_uris: string[];
};

export async function registerClient(redirectUris: string[]) {
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.rpc("oauth_register_client", {
    p_redirect_uris: redirectUris,
  });
  if (error || typeof data !== "string") throw error ?? new Error("register_failed");
  return { client_id: data, redirect_uris: redirectUris };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (/^https?:\/\//i.test(clientId)) {
    return fetchClientMetadata(clientId);
  }

  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.rpc("oauth_get_client", {
    p_client_id: clientId,
  });
  if (error || !data || typeof data !== "object") return null;
  const row = data as { client_id?: string; redirect_uris?: string[] };
  const uris = row.redirect_uris ?? [];
  if (!row.client_id || !Array.isArray(uris)) return null;
  return { client_id: row.client_id, redirect_uris: uris };
}

export function redirectAllowed(client: OAuthClient, redirectUri: string) {
  return uriAllowed(client.redirect_uris, redirectUri);
}

export async function saveCode(row: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  access_token: string;
  refresh_token: string | null;
  user_id: string;
}) {
  const supabase = createSupabaseUserClient(row.access_token);
  const { error } = await supabase.rpc("oauth_save_code", {
    p_code: row.code,
    p_client_id: row.client_id,
    p_redirect_uri: row.redirect_uri,
    p_code_challenge: row.code_challenge,
    p_access_token: row.access_token,
    p_refresh_token: row.refresh_token,
    p_user_id: row.user_id,
  });
  if (error) throw error;
}

export type ExchangedCode = {
  userId: string;
  supabaseAccess: string;
  supabaseRefresh: string;
};

export type OauthAdminRpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function exchangedRow(data: unknown): ExchangedCode | null {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { user_id?: string; access_token?: string; refresh_token?: string | null }
    | undefined;
  if (!row?.user_id || !row.access_token || !row.refresh_token) return null;
  return {
    userId: row.user_id,
    supabaseAccess: row.access_token,
    supabaseRefresh: row.refresh_token,
  };
}

/** Consume a code only when PKCE, client and redirect match. Service role only. */
export async function exchangeAuthorizationCode(
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
  },
  admin?: OauthAdminRpc,
): Promise<ExchangedCode | null> {
  const client = admin ?? createSupabaseAdminClient();
  const { data, error } = await client.rpc("oauth_exchange_code", {
    p_code: input.code,
    p_client_id: input.clientId,
    p_redirect_uri: input.redirectUri,
    p_code_challenge: input.codeChallenge,
  });
  if (error) throw error;
  return exchangedRow(data);
}
