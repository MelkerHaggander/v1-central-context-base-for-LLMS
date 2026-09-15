import { createMemoryApi, createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: jsonError("UNAUTHENTICATED", "Inte inloggad.", 401) };
  }
  return { supabase, userId: data.user.id };
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const offsetRaw = url.searchParams.get("offset");
  const api = createMemoryApi(createSupabaseStore(auth.supabase));
  const result = await api.searchMemory(auth.userId, {
    project: url.searchParams.get("project") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    query: url.searchParams.get("query") ?? undefined,
    offset: offsetRaw == null || offsetRaw === "" ? 0 : Number(offsetRaw),
  });

  if ("error" in result) {
    return jsonError(result.error.code, result.error.message, 400);
  }
  return jsonOwned(result.data, auth.userId);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const api = createMemoryApi(createSupabaseStore(auth.supabase));
  const result = await api.saveMemory(auth.userId, {
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
  });

  if ("error" in result) {
    const status = result.error.code.startsWith("INVALID_") ? 400 : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, auth.userId, 201);
}
