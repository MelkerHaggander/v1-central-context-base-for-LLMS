import { ConnectView } from "@/components/ConnectView";
import { mcpUrl } from "@/lib/mcp-url";

export const dynamic = "force-dynamic";

/** Serverkomponent: läser MCP-adressen ur miljön vid varje anrop och skickar ner till klienten. */
export default function ConnectPage() {
  return <ConnectView url={mcpUrl()} />;
}
