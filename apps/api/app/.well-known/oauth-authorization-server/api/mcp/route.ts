import { authorizationServerMetadataResponse, authorizationServerOptions } from "@/lib/oauth/authorization-server";

export const dynamic = "force-dynamic";

/** RFC 8414 path-appended metadata some MCP clients request for /api/mcp. */
export function GET(request: Request) {
  return authorizationServerMetadataResponse(request);
}

export function OPTIONS() {
  return authorizationServerOptions();
}
