// MOCK, proposed. PATCH /api/spaces/:id { name } -> the renamed team.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { statusFor } from "@/lib/mock/status";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/spaces/${encodeURIComponent(id)}`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }
  const result = mockDb.renameSpace(account.id, id, String(body.name ?? ""));
  if ("error" in result) return jsonError(result.error.code, result.error.message, statusFor(result.error.code));
  return jsonOwned(result.data, account.id);
}
