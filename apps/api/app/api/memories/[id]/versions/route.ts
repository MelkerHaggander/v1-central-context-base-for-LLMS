import { createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { getMemoryVersions } from "@/lib/memory-http";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  const { id } = await context.params;
  const result = await getMemoryVersions(data.user.id, id, {
    store: createSupabaseStore(supabase),
    spaces: createSupabaseSpaceAccess(supabase),
  });
  if (result.status >= 400) {
    const body = result.body as { error: { code: string; message: string } };
    return jsonError(body.error.code, body.error.message, result.status);
  }
  return jsonOwned(result.body, data.user.id);
}
