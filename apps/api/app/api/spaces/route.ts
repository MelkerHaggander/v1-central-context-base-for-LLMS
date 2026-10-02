import { jsonError, jsonOwned } from "@/lib/http";
import { listMemberSpaces, loadMemberSpaces, parseTeamName } from "@/lib/spaces-http";
import { createSupabaseAdminClient } from "@/lib/supabase/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  try {
    const result = listMemberSpaces(await loadMemberSpaces(supabase, data.user.id));
    return jsonOwned(result.body, data.user.id);
  } catch {
    return jsonError("SPACES_FAILED", "Utrymmena kunde inte hämtas.", 500);
  }
}

/**
 * POST /api/spaces { name } -> 201 { id, kind: "shared", name }.
 * Caller becomes the first member. Uses the admin client because RLS only
 * grants SELECT on spaces / space_members.
 */
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
    return jsonError("INVALID_BODY", "The request was not valid JSON.", 400);
  }

  const parsed = parseTeamName(body.name);
  if (!parsed.ok) {
    return jsonError(parsed.code, parsed.message, 400);
  }

  try {
    const admin = createSupabaseAdminClient();
    const inserted = await admin
      .from("spaces")
      .insert({ kind: "shared", name: parsed.name })
      .select("id, kind, name")
      .single();
    if (inserted.error || !inserted.data) {
      return jsonError("SPACES_FAILED", "Teamet kunde inte skapas.", 500);
    }

    const member = await admin.from("space_members").insert({
      space_id: inserted.data.id,
      user_id: data.user.id,
    });
    if (member.error) {
      // Best-effort cleanup so a failed membership does not leave an empty team.
      await admin.from("spaces").delete().eq("id", inserted.data.id);
      return jsonError("SPACES_FAILED", "Teamet kunde inte skapas.", 500);
    }

    return jsonOwned(
      {
        id: inserted.data.id,
        kind: "shared" as const,
        name: inserted.data.name ?? parsed.name,
      },
      data.user.id,
      201,
    );
  } catch {
    return jsonError("SPACES_FAILED", "Teamet kunde inte skapas.", 500);
  }
}
