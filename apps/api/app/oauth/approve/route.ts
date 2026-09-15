import { createSupabaseAnonClient } from "@/lib/supabase/clients";
import { randomToken } from "@/lib/oauth/crypto";
import { getClient, redirectAllowed, saveCode } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

function fail(request: Request, form: FormData, code: string) {
  const back = new URL("/oauth/authorize", request.url);
  back.searchParams.set("client_id", String(form.get("client_id") ?? ""));
  back.searchParams.set("redirect_uri", String(form.get("redirect_uri") ?? ""));
  back.searchParams.set("state", String(form.get("state") ?? ""));
  back.searchParams.set("code_challenge", String(form.get("code_challenge") ?? ""));
  back.searchParams.set("code_challenge_method", String(form.get("code_challenge_method") ?? "S256"));
  back.searchParams.set("error", code);
  const email = String(form.get("email") ?? "").trim();
  if (email) back.searchParams.set("email", email);
  return Response.redirect(back, 303);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const method = String(form.get("code_challenge_method") ?? "S256");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (method !== "S256" || !clientId || !redirectUri || !codeChallenge) {
    return fail(request, form, "invalid");
  }

  try {
    const client = await getClient(clientId);
    if (!client || !redirectAllowed(client, redirectUri)) {
      return fail(request, form, "client");
    }

    const supabase = createSupabaseAnonClient();
    await supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      return fail(request, form, "credentials");
    }

    const code = randomToken();
    await saveCode({
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user_id: data.user.id,
    });

    const next = new URL(redirectUri);
    next.searchParams.set("code", code);
    if (state) next.searchParams.set("state", state);
    return Response.redirect(next, 302);
  } catch (error) {
    console.error("oauth_approve_failed", error);
    return fail(request, form, "store");
  }
}
