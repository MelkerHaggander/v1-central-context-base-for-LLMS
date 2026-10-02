import { jsonOk } from "@/lib/http";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  return jsonOk({ data: { success: true } });
}
