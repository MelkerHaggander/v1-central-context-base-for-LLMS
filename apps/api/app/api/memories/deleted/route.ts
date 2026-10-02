import { jsonError, jsonOwned } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

/**
 * Lists delete history still inside the 30-day window.
 * Older rows are removed by the Supabase cron purge_expired_deleted_memories
 * (migration 20261001190000), not on this request, so a list stays a read.
 */
export async function GET(request: Request) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  const spaceId = new URL(request.url).searchParams.get("space_id") ?? "";
  if (!spaceId.trim()) return jsonError("INVALID_SPACE", "space_id krävs.", 400);

  const result = await callPythonBrain(
    "list_deletions",
    auth.userId,
    { space_id: spaceId },
    auth.bearer,
  );
  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "list"));
  }
  return jsonOwned(result.data, auth.userId);
}
