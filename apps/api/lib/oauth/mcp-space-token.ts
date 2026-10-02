/**
 * Space rows are protected by RLS on auth.uid().
 * Grok's bearer is an opaque MCP token, not a Supabase JWT, so that lookup
 * returns no space and save_memory writes nothing.
 * The OAuth session already stores the user's Supabase access token.
 */
export function bearerForSpaceAccess(input: {
  bearer: string;
  mcpAccess?: string;
  supabaseAccess: string | null;
}): string {
  if (!input.mcpAccess) return input.bearer;
  if (!input.supabaseAccess) throw new Error("UNAUTHENTICATED");
  return input.supabaseAccess;
}
