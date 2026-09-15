import { protectedResourceMetadataResponse, protectedResourceOptions } from "@/lib/oauth/protected-resource";

export const dynamic = "force-dynamic";

/** RFC 9728 path-appended metadata for https://host/api/mcp — ChatGPT looks here first. */
export function GET(request: Request) {
  return protectedResourceMetadataResponse(request);
}

export const OPTIONS = protectedResourceOptions;
