import { jsonError, jsonOwned } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const result = await callPythonBrain("list_versions", auth.userId, { id }, auth.bearer);
  if (result.error) {
    return jsonError(result.error.code, result.error.message, memoryHttpStatus(result.error.code, "remove"));
  }
  return jsonOwned(result.data, auth.userId);
}
