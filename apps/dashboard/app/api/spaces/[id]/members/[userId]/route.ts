// MOCK, proposed. DELETE /api/spaces/:id/members/:userId -> { success: true }.
// Removing yourself is leaving. The last member cannot leave.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { statusFor } from "@/lib/mock/status";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await ctx.params;
  const up = await proxyToUpstream(
    request,
    `/api/spaces/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
  );
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const result = mockDb.removeMember(account.id, id, userId);
  if ("error" in result) return jsonError(result.error.code, result.error.message, statusFor(result.error.code));
  return jsonOwned(result.data, account.id);
}
