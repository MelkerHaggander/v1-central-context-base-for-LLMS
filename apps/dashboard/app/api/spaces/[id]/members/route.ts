// MOCK, proposed.
//   GET  /api/spaces/:id/members            -> { members: [{ user_id, email }] }
//   POST /api/spaces/:id/members { email }  -> 201 { user_id, email }
// Only an existing account can be added: there is no public sign-up.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { statusFor } from "@/lib/mock/status";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/spaces/${encodeURIComponent(id)}/members`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const result = mockDb.listMembers(account.id, id);
  if ("error" in result) return jsonError(result.error.code, result.error.message, statusFor(result.error.code));
  return jsonOwned({ members: result.data }, account.id);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/spaces/${encodeURIComponent(id)}/members`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }
  const result = mockDb.addMember(account.id, id, String(body.email ?? ""));
  if ("error" in result) return jsonError(result.error.code, result.error.message, statusFor(result.error.code));
  return jsonOwned(result.data, account.id, 201);
}
