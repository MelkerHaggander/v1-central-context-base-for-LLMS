function readEnv(name: string) {
  const value = process.env[name]?.trim() || "";
  if (!value || value === "[REDACTED]") return "";
  return value;
}

export function getSupabaseUrl() {
  const fromEnv = readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL");
  return fromEnv.replace(/\/$/, "");
}

export function getSupabaseAnonKey() {
  const fromEnv =
    readEnv("SUPABASE_ANON_KEY") ||
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (fromEnv.startsWith("eyJ") || fromEnv.startsWith("sb_")) return fromEnv;
  return "";
}

export function getSupabaseServiceRoleKey() {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function supabaseEnvSource() {
  const urlFromEnv = Boolean(readEnv("SUPABASE_URL") || readEnv("NEXT_PUBLIC_SUPABASE_URL"));
  const keyFromEnv = Boolean(
    readEnv("SUPABASE_ANON_KEY") ||
      readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      readEnv("SUPABASE_PUBLISHABLE_KEY"),
  );
  return urlFromEnv && keyFromEnv ? "env" : "fallback";
}
