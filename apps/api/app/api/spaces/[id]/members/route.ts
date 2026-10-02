import { jsonError, jsonOwned } from "@/lib/http";
import { listSpaceMembers, type SpaceMember } from "@/lib/spaces-http";
import { createSupabaseSpaceAccess } from "@/lib/space-access";
import { createSupabaseAdminClient } from "@/lib/supabase/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET  /api/spaces/:id/members
 * POST /api/spaces/:id/members { email } -> 201 { user_id, email }
 * Only an existing Auth account can be added (no public sign-up).
 * RLS has no INSERT on space_members, so writes use the admin client.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    return jsonError("SPACES_FAILED", "Medlemmarna kunde inte hämtas.", 500);
  }
  if (!member) {
    return jsonError("FORBIDDEN", "Du är inte medlem i det utrymmet.", 403);
  }

  try {
    return jsonOwned(listSpaceMembers(await memberEmails(id)), data.user.id);
  } catch {
    return jsonError("SPACES_FAILED", "Medlemmarna kunde inte hämtas.", 500);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
    return jsonError("SPACES_FAILED", "Medlemmen kunde inte läggas till.", 500);
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

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("INVALID_EMAIL", "That is not an email address.", 400);
  }

  try {
    const admin = createSupabaseAdminClient();
    const space = await admin.from("spaces").select("id, kind").eq("id", id).maybeSingle();
    if (space.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte läggas till.", 500);
    }
    if (!space.data) {
      return jsonError("NOT_FOUND", "Utrymmet finns inte.", 404);
    }
    if (space.data.kind !== "shared") {
      return jsonError("PERSONAL_SPACE", "A personal space has no members to manage.", 400);
    }

    // Accounts are few and created by hand; page Auth until the email matches.
    const found = await findAuthUserByEmail(admin, email);
    if (!found) {
      return jsonError("NO_ACCOUNT", "No account has that email. Accounts are created by hand.", 404);
    }

    const existing = await admin
      .from("space_members")
      .select("user_id")
      .eq("space_id", id)
      .eq("user_id", found.id)
      .maybeSingle();
    if (existing.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte läggas till.", 500);
    }
    if (existing.data) {
      return jsonError("ALREADY_MEMBER", "That account is already in the team.", 409);
    }

    const inserted = await admin.from("space_members").insert({
      space_id: id,
      user_id: found.id,
    });
    if (inserted.error) {
      return jsonError("SPACES_FAILED", "Medlemmen kunde inte läggas till.", 500);
    }

    return jsonOwned({ user_id: found.id, email: found.email }, data.user.id, 201);
  } catch {
    return jsonError("SPACES_FAILED", "Medlemmen kunde inte läggas till.", 500);
  }
}

async function memberEmails(spaceId: string): Promise<SpaceMember[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("space_members").select("user_id").eq("space_id", spaceId);
  if (error) throw new Error(error.message);
  const members: SpaceMember[] = [];
  for (const row of data ?? []) {
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    if (!userId) continue;
    const found = await admin.auth.admin.getUserById(userId);
    const email = found.data.user?.email;
    if (found.error || !email) throw new Error("member email missing");
    members.push({ user_id: userId, email });
  }
  return members;
}

/** Look up an Auth user by email. Returns null when no account exists. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
): Promise<{ id: string; email: string } | null> {
  let page = 1;
  for (;;) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    const users = listed.data.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match?.email) return { id: match.id, email: match.email };
    if (users.length < 200) return null;
    page += 1;
  }
}
