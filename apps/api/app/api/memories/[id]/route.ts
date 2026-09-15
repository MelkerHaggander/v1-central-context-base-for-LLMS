import { createMemoryApi, createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const api = createMemoryApi(createSupabaseStore(supabase));
  const result = await api.updateMemory(data.user.id, {
    id,
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
  });

  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code.startsWith("INVALID_")
          ? 400
          : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, data.user.id);
}
