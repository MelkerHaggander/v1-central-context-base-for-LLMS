import { createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { deleteMemoryHttp, patchMemory } from "@/lib/memory-http";
import { createBrainClients } from "@/lib/memory-clients";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
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

function deps(supabase: { from: Parameters<typeof createSupabaseStore>[0]["from"] }) {
  return {
    store: createSupabaseStore(supabase),
    spaces: createSupabaseSpaceAccess(supabase),
    embedding: createBrainClients().embedding,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const result = await patchMemory(auth.userId, id, body, deps(auth.supabase));
  if (result.status >= 400) {
    const errorBody = result.body as { error: { code: string; message: string } };
    return jsonError(errorBody.error.code, errorBody.error.message, result.status);
  }
  return jsonOwned(result.body, auth.userId);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const result = await deleteMemoryHttp(auth.userId, id, deps(auth.supabase));
  if (result.status >= 400) {
    const errorBody = result.body as { error: { code: string; message: string } };
    return jsonError(errorBody.error.code, errorBody.error.message, result.status);
  }
  return jsonOwned(result.body, auth.userId);
}
