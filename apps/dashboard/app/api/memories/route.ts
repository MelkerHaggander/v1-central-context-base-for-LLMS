// MOCK. Same shape as apps/api/app/api/memories/route.ts on v1.2 (c31e656):
//   GET  ?space_id= -> plain JSON list (not { data: [...] })
//   POST { ...fields, space_id } -> memory object, 201
//   no space_id -> INVALID_SPACE 400, not a member -> FORBIDDEN 403
//   not signed in -> { error: { code: "UNAUTHENTICATED" } }, 401
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const up = await proxyToUpstream(request, "/api/memories");
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  const url = new URL(request.url);
  const offsetRaw = url.searchParams.get("offset");
  const result = mockDb.searchInSpace(account.id, url.searchParams.get("space_id") ?? "", {
    project: url.searchParams.get("project") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    query: url.searchParams.get("query") ?? undefined,
    offset: offsetRaw == null || offsetRaw === "" ? 0 : Number(offsetRaw),
  });

  if ("error" in result) {
    return jsonError(result.error.code, result.error.message, result.error.code === "FORBIDDEN" ? 403 : 400);
  }
  return jsonOwned(result.data, account.id);
}

export async function POST(request: Request) {
  const up = await proxyToUpstream(request, "/api/memories");
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }

  const result = mockDb.saveInSpace(account.id, typeof body.space_id === "string" ? body.space_id : "", {
    project: String(body.project ?? ""),
    category: String(body.category ?? ""),
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
  });

  if ("error" in result) {
    const status =
      result.error.code === "FORBIDDEN" ? 403 : result.error.code.startsWith("INVALID_") ? 400 : 500;
    return jsonError(result.error.code, result.error.message, status);
  }
  return jsonOwned(result.data, account.id, 201);
}
