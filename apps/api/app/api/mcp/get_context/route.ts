import { jsonError, jsonOk } from "@/lib/http";
import { callPythonBrain } from "@/lib/python-brain";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }
  const session = await supabase.auth.getSession();
  const bearer = session.data.session?.access_token ?? "";

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const result = await callPythonBrain(
    "get_context",
    data.user.id,
    {
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      project: typeof body.project === "string" ? body.project : undefined,
    },
    bearer,
  );

  if (result.error) {
    const status = result.error.code.startsWith("INVALID_") ? 400 : result.error.code === "UNAUTHENTICATED" ? 401 : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOk(result.data);
}
