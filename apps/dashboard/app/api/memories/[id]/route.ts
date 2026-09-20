// MOCK. PATCH /api/memories/:id -> uppdaterat minne, eller error-objekt.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/memories/${encodeURIComponent(id)}`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }

  const result = mockDb.updateMemory(account.id, {
    id,
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
    allow_project_change: body.allow_project_change === true,
  });

  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND"
        ? 404
        : result.error.code.startsWith("INVALID_") ||
            result.error.code === "PROJECT_CHANGE_REQUIRES_FLAG" ||
            result.error.code === "LESSON_CATEGORY_REQUIRES_TOOL"
          ? 400
          : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, account.id);
}

// MOCK. DELETE /api/memories/:id -> { success: true }, eller error-objekt.
// Finns inte som MCP-verktyg. Bara cookie-session.
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const up = await proxyToUpstream(request, `/api/memories/${encodeURIComponent(id)}`);
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const result = mockDb.deleteMemory(account.id, id);
  if ("error" in result) {
    const status =
      result.error.code === "NOT_FOUND" ? 404 : result.error.code.startsWith("INVALID_") ? 400 : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  // Kontraktet i docs/filip-auth.md: naket { success: true }, inte { data }.
  return jsonOwned(result.data, account.id);
}
