import { ConnectView } from "@/components/ConnectView";
import { mcpUrl } from "@/lib/mcp-url";

export const dynamic = "force-dynamic";

/**
 * Server component: reads the MCP address from the environment on every request
 * and hands it to the client.
 *
 * The canonical path is /connect now that the product is in English. /anslut is
 * kept as a redirect, because it is written down in Confluence and in handover
 * pages and those links must keep working.
 */
export default function ConnectPage() {
  return <ConnectView url={mcpUrl()} />;
}
