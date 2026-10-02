import { jsonError, jsonOwned } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const result = await callPythonBrain(
    "update_memory",
    auth.userId,
    {
      id,
      project: String(body.project ?? ""),
      category: String(body.category ?? ""),
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
      allow_project_change: body.allow_project_change === true,
    },
    auth.bearer,
  );
  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "update"));
  }
  return jsonOwned(result.data, auth.userId);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const result = await callPythonBrain("delete_memory", auth.userId, { id }, auth.bearer);
  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "remove"));
  }
  return jsonOwned(result.data, auth.userId);
}
