import { createMemoryApi, createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOk } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const api = createMemoryApi(createSupabaseStore(supabase));
  const result = await api.updateMemory(data.user.id, {
    id: String(body.id ?? ""),
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
    allow_project_change: body.allow_project_change === true,
  });

  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code.startsWith("INVALID_") ||
            result.error.code === "PROJECT_CHANGE_REQUIRES_FLAG" ||
            result.error.code === "LESSON_CATEGORY_REQUIRES_TOOL"
          ? 400
          : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOk(result.data);
}
