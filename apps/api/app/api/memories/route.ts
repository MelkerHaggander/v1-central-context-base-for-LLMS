import { jsonError, jsonOwned } from "@/lib/http";
import { callPythonBrain, memoryHttpStatus, type MemorySurface } from "@/lib/python-brain";
import { signedIn } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

function refused(code: string, message: string, surface: MemorySurface) {
  return jsonError(code, message, memoryHttpStatus(code, surface));
}

export async function GET(request: Request) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const spaceId = (url.searchParams.get("space_id") ?? "").trim();
  if (!spaceId) return jsonError("INVALID_SPACE", "space_id krävs.", 400);

  const offsetRaw = url.searchParams.get("offset");
  const result = await callPythonBrain(
    "search_in_space",
    auth.userId,
    {
      space_id: spaceId,
      project: url.searchParams.get("project") ?? "",
      category: url.searchParams.get("category") ?? "",
      query: url.searchParams.get("query") ?? "",
      offset: offsetRaw == null || offsetRaw === "" ? 0 : offsetRaw,
    },
    auth.bearer,
  );
  if (result.error) return refused(result.error.code, result.error.message, "list");
  return jsonOwned(result.data, auth.userId);
}

export async function POST(request: Request) {
  const auth = await signedIn();
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "Ogiltig JSON.", 400);
  }

  const spaceId = typeof body.space_id === "string" ? body.space_id.trim() : "";
  if (!spaceId) return jsonError("INVALID_SPACE", "space_id krävs.", 400);

  const result = await callPythonBrain(
    "save_dashboard",
    auth.userId,
    {
      space_id: spaceId,
      project: String(body.project ?? ""),
      category: String(body.category ?? ""),
      title: String(body.title ?? ""),
      content: String(body.content ?? ""),
    },
    auth.bearer,
  );
  if (result.error) return refused(result.error.code, result.error.message, "create");
  return jsonOwned(result.data, auth.userId, 201);
}
