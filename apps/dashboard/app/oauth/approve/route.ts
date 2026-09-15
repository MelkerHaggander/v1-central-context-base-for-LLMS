// MOCK av /oauth/approve. Verifierar mot mock-kontona och skickar tillbaka till /oauth/authorize
// med ?result=connected eller ?error=credentials. Ingen riktig kod/token utfärdas.
// Neka går aldrig hit: knappen länkar direkt till redirect_uri?error=access_denied (se OAuthApproveView).
import { NextResponse } from "next/server";
import { findAccount } from "@/lib/mock/accounts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const form = await request.formData();
  const s = (key: string) => String(form.get(key) ?? "");

  const back = new URL("/oauth/authorize", request.url);
  for (const key of ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "resource"]) {
    if (s(key)) back.searchParams.set(key, s(key));
  }
  if (s("email")) back.searchParams.set("email", s("email"));

  const account = findAccount(s("email"), s("password"));
  if (!account) {
    back.searchParams.set("error", "credentials");
    return NextResponse.redirect(back, 303);
  }

  back.searchParams.set("result", "connected");
  return NextResponse.redirect(back, 303);
}
