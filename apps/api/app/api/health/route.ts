import { jsonOk } from "@/lib/http";
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl, supabaseEnvSource } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export function GET() {
  return jsonOk({
    ok: true,
    region: "arn1",
    supabaseUrlSet: Boolean(getSupabaseUrl()),
    anonKeySet: Boolean(getSupabaseAnonKey()),
    supabaseEnv: supabaseEnvSource(),
    serviceRoleSet: Boolean(getSupabaseServiceRoleKey()),
    mcp: "1.5.0",
    chatgpt: "mixed-auth",
    grok: "oauth-first",
    mcpAuth: "lifetime",
  });
}
