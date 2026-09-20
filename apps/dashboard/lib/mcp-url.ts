/** Production-aliaset. Unika Vercel-hashar och -git- previewer byts vid varje deploy. */
export const STABLE_MCP_HOST = "v1-central-context-base-for-llms.vercel.app";
export const STABLE_MCP_URL = `https://${STABLE_MCP_HOST}/api/mcp`;

function mcpPath(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

/** True bara för adresser som får klistras in i Claude, ChatGPT och Grok. */
export function isDurableMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (mcpPath(parsed) !== "/api/mcp") return false;
    const host = parsed.hostname.toLowerCase();
    if (host.includes("-git-")) return false;
    if (host.endsWith(".vercel.app") && host !== STABLE_MCP_HOST) return false;
    return true;
  } catch {
    return false;
  }
}

export function visibleMcpUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && isDurableMcpUrl(trimmed)) return trimmed.replace(/\/+$/, "");
  return STABLE_MCP_URL;
}

/** Adress till fjärr-MCP som visas i anslutningsguiden. */
export function mcpUrl(): string {
  return visibleMcpUrl(process.env.NEXT_PUBLIC_MCP_URL ?? "");
}
