import { jsonError, jsonOwned } from "@/lib/http";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
import { createSupabaseAdminClient } from "@/lib/supabase/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/spaces/:id/members/:userId -> { success: true }.
 * Removing yourself is leaving. The last member cannot leave.
 * Admin client: RLS has no DELETE on space_members.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId: memberId } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  let member = false;
  try {
    member = await createSupabaseSpaceAccess(supabase).isMember(data.user.id, id);
  } catch {
    return jsonError("SPACES_FAILED", "Medlemmen kunde inte tas bort.", 500);
  }
  if (!member) {
    return jsonError("FORBIDDEN", "Du är inte medlem i det utrymmet.", 403);
  }

  try {
    const admin = createSupabaseAdminClient();
    const space = await admin.from("spaces").select("id, kind").eq("id", id).maybeSingle();
    if (space.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte tas bort.", 500);
    }
    if (!space.data) {
      return jsonError("NOT_FOUND", "Utrymmet finns inte.", 404);
    }
    if (space.data.kind !== "shared") {
      return jsonError("PERSONAL_SPACE", "A personal space has no members to manage.", 400);
    }

    const rows = await admin.from("space_members").select("user_id").eq("space_id", id);
    if (rows.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte tas bort.", 500);
    }
    const ids = (rows.data ?? []).map((row) => row.user_id).filter(Boolean);
    if (!ids.includes(memberId)) {
      return jsonError("NOT_A_MEMBER", "That account is not in the team.", 404);
    }
    // A team is never left empty.
    if (ids.length <= 1) {
      return jsonError("LAST_MEMBER", "The last member cannot leave. A team is never left empty.", 409);
    }

    const removed = await admin
      .from("space_members")
      .delete()
      .eq("space_id", id)
      .eq("user_id", memberId);
    if (removed.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte tas bort.", 500);
    }

    return jsonOwned({ success: true }, data.user.id);
  } catch {
    return jsonError("SPACES_FAILED", "Medlemmen kunde inte tas bort.", 500);
  }
}
