import { jsonError } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The access token is what Python sends as the user, so row security still applies. */
export async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonError("UNAUTHENTICATED", "Inte inloggad.", 401) };
  }
  const session = await supabase.auth.getSession();
  return { userId: data.user.id, bearer: session.data.session?.access_token ?? "" };
}
