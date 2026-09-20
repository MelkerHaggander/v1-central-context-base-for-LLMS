import { authorizationCodeGrant } from "@/lib/oauth/authorization-code";
import { canonicalMcpResource, resourceAllowed } from "@/lib/oauth/resource";
import { rotateMcpRefresh, type IssuedTokens } from "@/lib/oauth/sessions";
import { publicOrigin } from "@/lib/oauth/urls";

export const dynamic = "force-dynamic";

const TOKEN_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

function tokenJson(issued: IssuedTokens, resource?: string) {
  return Response.json(
    {
      access_token: issued.access_token,
      token_type: "Bearer",
      expires_in: issued.expires_in,
      refresh_token: issued.refresh_token,
      scope: "memory",
      ...(resource ? { resource } : {}),
    },
    { headers: TOKEN_HEADERS },
  );
}

async function readParams(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => null);
    return (json ?? {}) as Record<string, string>;
  }
  const form = await request.formData().catch(() => null);
  if (form) return Object.fromEntries(form.entries()) as Record<string, string>;
  const json = await request.json().catch(() => null);
  return (json ?? {}) as Record<string, string>;
}

export async function POST(request: Request) {
  try {
    const params = await readParams(request);
    const grant = String(params.grant_type ?? "");
    const origin = publicOrigin(request);
    const resource = String(params.resource ?? "").trim();
    if (resource && !resourceAllowed(origin, resource)) {
      return Response.json({ error: "invalid_target" }, { status: 400, headers: TOKEN_HEADERS });
    }
    const boundResource = resource ? canonicalMcpResource(origin) : undefined;

    if (grant === "refresh_token") {
      const refreshToken = String(params.refresh_token ?? "");
      if (!refreshToken) {
        return Response.json({ error: "invalid_request" }, { status: 400, headers: TOKEN_HEADERS });
      }
      const issued = await rotateMcpRefresh(refreshToken);
      if (!issued) {
        return Response.json({ error: "invalid_grant" }, { status: 400, headers: TOKEN_HEADERS });
      }
      return tokenJson(issued, boundResource);
    }

    if (grant !== "authorization_code") {
      return Response.json({ error: "unsupported_grant_type" }, { status: 400, headers: TOKEN_HEADERS });
    }

    const result = await authorizationCodeGrant(params);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 400, headers: TOKEN_HEADERS });
    }
    return tokenJson(result.issued, boundResource);
  } catch (error) {
    const misconfigured =
      error instanceof Error && error.message === "Missing SUPABASE_SERVICE_ROLE_KEY";
    console.error(misconfigured ? "oauth_token_misconfigured" : "oauth_token_failed");
    return Response.json({ error: "server_error" }, { status: 500, headers: TOKEN_HEADERS });
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
    },
  });
}
