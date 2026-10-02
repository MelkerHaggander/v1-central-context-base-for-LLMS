import { createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { getDeletedMemories } from "@/lib/memory-http";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Lists delete history still inside the 30-day window.
 * Rows older than that are removed by the Supabase cron
 * purge_expired_deleted_memories (migration 20261001190000), not here.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  const spaceId = new URL(request.url).searchParams.get("space_id") ?? "";
  const result = await getDeletedMemories(data.user.id, spaceId, {
    store: createSupabaseStore(supabase),
    spaces: createSupabaseSpaceAccess(supabase),
  });
  if (result.status >= 400) {
    const body = result.body as { error: { code: string; message: string } };
    return jsonError(body.error.code, body.error.message, result.status);
  }
  return jsonOwned(result.body, data.user.id);
}
