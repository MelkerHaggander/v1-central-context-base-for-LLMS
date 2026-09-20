import { ConnectView } from "@/components/ConnectView";
import { mcpUrl } from "@/lib/mcp-url";

export const dynamic = "force-dynamic";

/**
 * Canonical English connect guide. /anslut redirects here so Confluence links
 * keep working. MCP address comes from mcp-url so unique Vercel previews never
 * get pasted.
 */
export default function ConnectPage() {
  return <ConnectView url={mcpUrl()} />;
}
