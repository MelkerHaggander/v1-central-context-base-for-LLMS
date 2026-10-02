export type McpConnection = {
  id: string;
  created_at: string;
};

function unwrap(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return unwrap(JSON.parse(data) as unknown);
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object" && !Array.isArray(data) && "oauth_list_my_sessions" in data) {
    return unwrap((data as { oauth_list_my_sessions: unknown }).oauth_list_my_sessions);
  }
  return data;
}

export function asMcpConnections(data: unknown): McpConnection[] | null {
  const value = unwrap(data);
  if (!Array.isArray(value)) return null;
  const rows: McpConnection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if ("access_token" in record || "refresh_token" in record || "supabase_access" in record) {
      return null;
    }
    if (typeof record.id !== "string" || typeof record.created_at !== "string") return null;
    if (!record.id.trim() || !record.created_at.trim()) return null;
    rows.push({ id: record.id, created_at: record.created_at });
  }
  return rows;
}
