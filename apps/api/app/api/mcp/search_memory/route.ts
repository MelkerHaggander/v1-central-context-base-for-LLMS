import { jsonError, jsonOk } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const result = await callPythonBrain(
    "search_memory",
    auth.userId,
    {
      project: body.project == null ? undefined : String(body.project),
      category: body.category == null ? undefined : String(body.category),
      query: body.query == null ? undefined : String(body.query),
      offset: body.offset == null ? 0 : body.offset,
    },
    auth.bearer,
  );

  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "search"));
  }
  return jsonOk(result.data);
}
