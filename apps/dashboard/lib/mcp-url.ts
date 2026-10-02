/**
 * Public host for this deployment. Unique Vercel hashes and -git- previews
 * change on every deploy, so the connect panel must not paste those.
 * Set NEXT_PUBLIC_MCP_HOST or NEXT_PUBLIC_APP_URL to the host you serve.
 */
export function stableMcpHost(): string {
  const raw = (process.env.NEXT_PUBLIC_MCP_HOST ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return "";
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme).host.toLowerCase();
  } catch {
    return "";
  }
}

export function stableMcpUrl(): string {
  const host = stableMcpHost();
  return host ? `https://${host}/api/mcp` : "";
}

function mcpPath(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

/** True only for addresses that may be pasted into Claude, ChatGPT and Grok. */
export function isDurableMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (mcpPath(parsed) !== "/api/mcp") return false;
    const host = parsed.hostname.toLowerCase();
    if (host.includes("-git-")) return false;
    if (host.endsWith(".vercel.app") && host !== stableMcpHost()) return false;
    return true;
  } catch {
    return false;
  }
}

export function visibleMcpUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && isDurableMcpUrl(trimmed)) return trimmed.replace(/\/+$/, "");
  return stableMcpUrl();
}

/** Address shown in the connect guide. */
export function mcpUrl(): string {
  return visibleMcpUrl(process.env.NEXT_PUBLIC_MCP_URL ?? "");
}
