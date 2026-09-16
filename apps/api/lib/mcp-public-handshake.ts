/** Handshake ChatGPT runs before OAuth, sometimes with a leftover Bearer header. Tool calls stay protected. */
export const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]);

export function isPublicMcpMethod(method: unknown): method is string {
  return typeof method === "string" && PUBLIC_MCP_METHODS.has(method);
}

export function isPublicMcpBody(body: unknown): boolean {
  const msgs = Array.isArray(body) ? body : [body];
  return (
    msgs.length > 0 &&
    msgs.every((msg) => msg && typeof msg === "object" && isPublicMcpMethod((msg as { method?: unknown }).method))
  );
}

export async function isPublicMcpHandshake(req: Request): Promise<boolean> {
  if (req.method !== "POST") return false;
  try {
    return isPublicMcpBody(await req.clone().json());
  } catch {
    return false;
  }
}
