import { validateMemoryId } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { asMcpConnections } from "@/lib/oauth/mcp-connections";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };
  return { supabase, user: data.user };
}

export async function GET() {
  const { supabase, user } = await signedIn();
  if (!user) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);
  const listed = await supabase.rpc("oauth_list_my_sessions");
  if (listed.error) return jsonError("CONNECTIONS_FAILED", "Could not load the connections.", 500);
  const connections = asMcpConnections(listed.data);
  if (!connections) return jsonError("CONNECTIONS_FAILED", "Could not load the connections.", 500);
  return jsonOwned({ connections }, user.id);
}

export async function DELETE(request: Request) {
  const { supabase, user } = await signedIn();
  if (!user) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: { id?: unknown; all?: unknown } = {};
  try {
    body = (await request.json()) as { id?: unknown; all?: unknown };
  } catch {
    body = {};
  }

  if (body.all === true) {
    const revoked = await supabase.rpc("oauth_revoke_my_sessions");
    if (revoked.error) return jsonError("CONNECTIONS_FAILED", "Could not remove the connections.", 500);
    return jsonOwned({ removed: true }, user.id);
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const parsed = validateMemoryId(id);
  if ("error" in parsed) return jsonError("INVALID_ID", "id must be a UUID.", 400);

  const revoked = await supabase.rpc("oauth_revoke_my_session", { p_id: parsed.data });
  if (revoked.error) return jsonError("CONNECTIONS_FAILED", "Could not remove the connection.", 500);
  if (revoked.data !== true) {
    return jsonError("CONNECTION_NOT_FOUND", "That connection is already gone.", 404);
  }
  return jsonOwned({ removed: true }, user.id);
}
