import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { mcpResourceUrl, publicOrigin } from "@/lib/oauth/urls";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
} as const;

export function protectedResourceMetadataResponse(request: Request) {
  const origin = publicOrigin(request);
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [origin],
    resourceUrl: mcpResourceUrl(origin),
    additionalMetadata: {
      bearer_methods_supported: ["header"],
      scopes_supported: ["memory"],
    },
  });
  return Response.json(metadata, {
    headers: {
      ...CORS,
      "Cache-Control": "max-age=3600",
    },
  });
}

export const protectedResourceOptions = metadataCorsOptionsRequestHandler();
