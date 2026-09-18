import { jsonError, jsonOk } from "@/lib/http";
import { createSupabaseUserClient } from "@/lib/supabase/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return jsonError("INVALID_CREDENTIALS", "Fel mejl eller lösenord.", 401);
  }

  const supabase = await createSupabaseServerClient();
  // En cookie-burk per webbläsare. Rensa förra kontot innan nästa loggas in,
  // så chunkade auth-cookies inte blandas mellan Melker och Filip.
  await supabase.auth.signOut();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return jsonError("INVALID_CREDENTIALS", "Fel mejl eller lösenord.", 401);
  }

  if (data.session?.access_token && data.session.refresh_token) {
    try {
      await createSupabaseUserClient(data.session.access_token).rpc("oauth_update_supabase_tokens_for_user", {
        p_user_id: data.user.id,
        p_supabase_access: data.session.access_token,
        p_supabase_refresh: data.session.refresh_token,
      });
    } catch {
      // Cookie login must still succeed if MCP session update fails.
    }
  }

  return jsonOk({
    data: { id: data.user.id, email: data.user.email },
  });
}
