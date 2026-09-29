import { createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOwned } from "@/lib/http";
import { getMemories, postMemory } from "@/lib/memory-http";
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

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const result = await getMemories(auth.userId, new URL(request.url), deps(auth.supabase));
  if (result.status >= 400) {
    const body = result.body as { error: { code: string; message: string } };
    return jsonError(body.error.code, body.error.message, result.status);
  }
  return jsonOwned(result.body, auth.userId);
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

  const result = await postMemory(auth.userId, body, deps(auth.supabase));
  if (result.status >= 400) {
    const errorBody = result.body as { error: { code: string; message: string } };
    return jsonError(errorBody.error.code, errorBody.error.message, result.status);
  }
  return jsonOwned(result.body, auth.userId, result.status);
}
