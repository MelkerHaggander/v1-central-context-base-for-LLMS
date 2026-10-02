// MOCK. GET /api/memories/:id/versions -> MemoryVersion[], newest first.
// Same shape as Melker's apps/api/app/api/memories/[id]/versions/route.ts (c31e656).
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/memories/${encodeURIComponent(id)}/versions`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const result = mockDb.listVersions(account.id, id);
  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code === "FORBIDDEN"
          ? 403
          : result.error.code.startsWith("INVALID_")
            ? 400
            : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, account.id);
}
