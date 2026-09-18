import { randomToken } from "@/lib/oauth/crypto";
import { asMcpSession, asReusedMcpTokens, type McpSession } from "@/lib/oauth/session-parse";
import { accessTokenExpiresIn } from "@/lib/oauth/tokens";
import { createSupabaseAnonClient, createSupabaseUserClient } from "@/lib/supabase/clients";

export type { McpSession } from "@/lib/oauth/session-parse";
export { asMcpSession } from "@/lib/oauth/session-parse";

/** Postgres keeps the row until this date. oauth_get_session does not check the clock. */
export const MCP_NEVER_EXPIRES_AT = "9999-12-31T00:00:00.000Z";

const INT32_MAX = 2_147_483_647;

/**
 * `expires_in` in the OAuth token response.
 * ChatGPT stores `now + expires_in` as a signed 32-bit unix time. 2^31-1
 * overflows that sum, so the connector looks expired and asks to log in again.
 * Stay below 2038-01-19. The server still never rejects the token.
 */
export function mcpClientExpiresIn(nowSeconds = Math.floor(Date.now() / 1000)) {
  return Math.max(60, INT32_MAX - nowSeconds - 86_400);
}

const supabaseRefreshInflight = new Map<string, Promise<{ access: string; refresh: string } | null>>();
const mcpRefreshInflight = new Map<string, Promise<IssuedTokens | null>>();

export type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  supabase_access: string;
};

export async function issueMcpTokens(input: {
  userId: string;
  supabaseAccess: string;
  supabaseRefresh: string;
}): Promise<IssuedTokens> {
  const access_token = randomToken();
  const refresh_token = randomToken();
  const supabase = createSupabaseUserClient(input.supabaseAccess);
  const { error } = await supabase.rpc("oauth_create_session", {
    p_access: access_token,
    p_refresh: refresh_token,
    p_user_id: input.userId,
    p_supabase_access: input.supabaseAccess,
    p_supabase_refresh: input.supabaseRefresh,
    p_access_expires: MCP_NEVER_EXPIRES_AT,
    p_refresh_expires: MCP_NEVER_EXPIRES_AT,
  });
  if (error) throw error;
  return {
    access_token,
    refresh_token,
    expires_in: mcpClientExpiresIn(),
    supabase_access: input.supabaseAccess,
  };
}

export async function getMcpSession(accessToken: string): Promise<McpSession | null> {
  const supabase = createSupabaseAnonClient();
  const { data, error } = await supabase.rpc("oauth_get_session", { p_access: accessToken });
  if (error) return null;
  return asMcpSession(data);
}

async function refreshSupabase(userId: string, refreshToken: string) {
  const existing = supabaseRefreshInflight.get(userId);
  if (existing) return existing;
  const pending = (async () => {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session?.access_token || !data.session.refresh_token) return null;
    return { access: data.session.access_token, refresh: data.session.refresh_token };
  })().finally(() => {
    supabaseRefreshInflight.delete(userId);
  });
  supabaseRefreshInflight.set(userId, pending);
  return pending;
}

export async function supabaseAccessForMcp(
  accessToken: string,
  session: McpSession,
  forceRefresh = false,
) {
  if (!forceRefresh && accessTokenExpiresIn(session.supabase_access, 0) > 90) {
    return session.supabase_access;
  }
  const refreshed = await refreshSupabase(session.user_id, session.supabase_refresh);
  if (!refreshed) return session.supabase_access;
  const supabase = createSupabaseUserClient(refreshed.access);
  await supabase.rpc("oauth_update_supabase_tokens_for_user", {
    p_user_id: session.user_id,
    p_supabase_access: refreshed.access,
    p_supabase_refresh: refreshed.refresh,
  });
  return refreshed.access;
}

export async function rotateMcpRefresh(refreshToken: string): Promise<IssuedTokens | null> {
  const existing = mcpRefreshInflight.get(refreshToken);
  if (existing) return existing;
  const pending = (async () => {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase.rpc("oauth_reuse_session", {
      p_refresh: refreshToken,
    });
    const row = asReusedMcpTokens(data);
    if (!error && row) {
      return {
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        expires_in: mcpClientExpiresIn(),
        supabase_access: row.supabase_access,
      };
    }

    const upgraded = await refreshSupabase(`legacy:${refreshToken.slice(0, 12)}`, refreshToken);
    if (!upgraded) return null;
    const userClient = createSupabaseAnonClient();
    const { data: userData } = await userClient.auth.getUser(upgraded.access);
    if (!userData.user) return null;
    return issueMcpTokens({
      userId: userData.user.id,
      supabaseAccess: upgraded.access,
      supabaseRefresh: upgraded.refresh,
    });
  })().finally(() => {
    mcpRefreshInflight.delete(refreshToken);
  });
  mcpRefreshInflight.set(refreshToken, pending);
  return pending;
}
