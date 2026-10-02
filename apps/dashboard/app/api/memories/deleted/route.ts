// MOCK. GET /api/memories/deleted?space_id= -> MemoryVersion[] with event "delete", newest first.
// Same shape as apps/api/app/api/memories/deleted/route.ts.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const up = await proxyToUpstream(request, "/api/memories/deleted");
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const spaceId = new URL(request.url).searchParams.get("space_id") ?? "";
  const result = mockDb.listDeletions(account.id, spaceId);
  if ("error" in result) {
    const status = result.error.code === "FORBIDDEN" ? 403 : 400;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, account.id);
}
