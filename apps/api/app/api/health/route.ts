import { jsonOk } from "@/lib/http";
import { pythonBrainCanStart } from "@/lib/python-brain";
import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl, supabaseEnvSource } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const pythonReady = await pythonBrainCanStart();
  return jsonOk({
    ok: true,
    region: "arn1",
    supabaseUrlSet: Boolean(getSupabaseUrl()),
    anonKeySet: Boolean(getSupabaseAnonKey()),
    supabaseEnv: supabaseEnvSource(),
    serviceRoleSet: Boolean(getSupabaseServiceRoleKey()),
    mcp: "1.2.0",
    brain: true,
    pythonReady,
    chatgpt: "mixed-auth",
    grok: "oauth-first",
    mcpAuth: "lifetime",
    lessonMemory: true,
    promptTransports: true,
  });
}
