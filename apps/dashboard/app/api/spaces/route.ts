// MOCK. GET /api/spaces -> { spaces: [{ id, kind, name? }] }, personal first.
// Same shape as Alfredo's apps/api/app/api/spaces/route.ts (PR #40, bbecb19);
// `name` and POST are the team proposal ("Förslag: team och medlemmar").
// No user id is taken from the client. The session decides.
import { mockDb } from "@/lib/mock/db";
import { currentAccount, jsonError, jsonOwned } from "@/lib/mock/session";
import { statusFor } from "@/lib/mock/status";
import { proxyToUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const up = await proxyToUpstream(request, "/api/spaces");
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  return jsonOwned({ spaces: mockDb.listSpaces(account.id) }, account.id);
}

/** Proposed: POST /api/spaces { name } -> 201 { id, kind: "shared", name }. The caller is its first member. */
export async function POST(request: Request) {
  const up = await proxyToUpstream(request, "/api/spaces");
  if (up) return up;

  const account = await currentAccount();
  if (!account) return jsonError("UNAUTHENTICATED", "You are not signed in.", 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }
  const result = mockDb.createSpace(account.id, String(body.name ?? ""));
  if ("error" in result) return jsonError(result.error.code, result.error.message, statusFor(result.error.code));
  return jsonOwned(result.data, account.id, 201);
}
