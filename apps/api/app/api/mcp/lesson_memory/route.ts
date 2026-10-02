import { jsonError, jsonOk } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const result = await callPythonBrain(
    "save_lesson",
    auth.userId,
    {
      project: String(body.project ?? ""),
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
    },
    auth.bearer,
  );

  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "save"));
  }
  return jsonOk(result.data);
}
