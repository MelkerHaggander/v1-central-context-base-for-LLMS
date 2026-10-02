import { jsonError, jsonOwned } from "@/lib/http";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
import { parseTeamName } from "@/lib/spaces-http";
import { createSupabaseAdminClient } from "@/lib/supabase/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/spaces/:id { name } -> the renamed shared space.
 * Personal spaces cannot be renamed. Any member may rename.
 * Admin client: RLS has no UPDATE policy on spaces.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return jsonError("UNAUTHENTICATED", "Inte inloggad.", 401);
  }

  let member = false;
  try {
    member = await createSupabaseSpaceAccess(supabase).isMember(data.user.id, id);
  } catch {
    return jsonError("SPACES_FAILED", "Teamet kunde inte byta namn.", 500);
  }
  if (!member) {
    return jsonError("FORBIDDEN", "Du är inte medlem i det utrymmet.", 403);
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
    const existing = await admin.from("spaces").select("id, kind, name").eq("id", id).maybeSingle();
    if (existing.error) {
      return jsonError("SPACES_FAILED", "Teamet kunde inte byta namn.", 500);
    }
    if (!existing.data) {
      return jsonError("NOT_FOUND", "Utrymmet finns inte.", 404);
    }
    if (existing.data.kind !== "shared") {
      return jsonError("PERSONAL_SPACE", "A personal space cannot be renamed.", 400);
    }

    const updated = await admin
      .from("spaces")
      .update({ name: parsed.name })
      .eq("id", id)
      .select("id, kind, name")
      .single();
    if (updated.error || !updated.data) {
      return jsonError("SPACES_FAILED", "Teamet kunde inte byta namn.", 500);
    }

    return jsonOwned(
      {
        id: updated.data.id,
        kind: "shared" as const,
        name: updated.data.name ?? parsed.name,
      },
      data.user.id,
    );
  } catch {
    return jsonError("SPACES_FAILED", "Teamet kunde inte byta namn.", 500);
  }
}
