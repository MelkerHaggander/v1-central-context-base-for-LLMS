import { pkceChallenge } from "@/lib/oauth/crypto";
import { canonicalMcpResource, resourceAllowed } from "@/lib/oauth/resource";
import { consumeCode } from "@/lib/oauth/store";
import { issueMcpTokens, rotateMcpRefresh, type IssuedTokens } from "@/lib/oauth/sessions";
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

    const code = String(params.code ?? "");
    const redirectUri = String(params.redirect_uri ?? "");
    const clientId = String(params.client_id ?? "");
    const verifier = String(params.code_verifier ?? "");
    const row = await consumeCode(code);

    if (
      !row ||
      row.client_id !== clientId ||
      row.redirect_uri !== redirectUri ||
      pkceChallenge(verifier) !== row.code_challenge ||
      !row.refresh_token
    ) {
      return Response.json({ error: "invalid_grant" }, { status: 400, headers: TOKEN_HEADERS });
    }

    const issued = await issueMcpTokens({
      userId: row.user_id,
      supabaseAccess: row.access_token,
      supabaseRefresh: row.refresh_token,
    });
    return tokenJson(issued, boundResource);
  } catch (error) {
    console.error("oauth_token_failed", error);
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
