import { createMemoryApi, createSupabaseStore } from "@v1/memory";
import { jsonError, jsonOk } from "@/lib/http";
import { createBrainClients } from "@/lib/memory-clients";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
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

  const clients = createBrainClients();
  const api = createMemoryApi(createSupabaseStore(supabase), {
    ...clients,
    spaces: createSupabaseSpaceAccess(supabase),
  });
  const result = await api.getContext(data.user.id, {
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    project: typeof body.project === "string" ? body.project : undefined,
  });

  if ("error" in result) {
    const status = result.error.code.startsWith("INVALID_") ? 400 : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOk(result.data);
}
