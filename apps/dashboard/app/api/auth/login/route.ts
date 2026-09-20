// MOCK. I måndagsläget (API_BASE_URL satt) går /api/auth/login till Alfredo i stället.
import { findAccount } from "@/lib/mock/accounts";
import { proxyToUpstream } from "@/lib/upstream";
import { jsonError, jsonOk, setSessionCookie } from "@/lib/mock/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const up = await proxyToUpstream(request, "/api/auth/login");
  if (up) return up;

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }

  const account = findAccount(body.email ?? "", body.password ?? "");
  if (!account) {
    return jsonError("INVALID_CREDENTIALS", "Wrong email or password.", 401);
  }

  return setSessionCookie(jsonOk({ data: { id: account.id, email: account.email } }), account.id);
}
