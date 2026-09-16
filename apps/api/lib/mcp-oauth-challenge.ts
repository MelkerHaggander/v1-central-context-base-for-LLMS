import { publicOrigin } from "@/lib/oauth/urls";

const GROK_HINT =
  /\bgrok\b|\bgrokbot\b|grok\.com|xai\/|x-ai|\bx\.ai\b|\bxai\b/i;

export function hasBearerToken(req: Request) {
  return /^bearer\s+\S+/i.test(req.headers.get("authorization") ?? "");
}

export function mcpResourceMetadataUrl(origin: string) {
  return `${origin.replace(/\/$/, "")}/.well-known/oauth-protected-resource/api/mcp`;
}

export function mcpWwwAuthenticate(origin: string) {
  const metadata = mcpResourceMetadataUrl(origin);
  return `Bearer realm="mcp", resource_metadata="${metadata}", error="invalid_token", error_description="Login required to call memory tools", scope="memory"`;
}

export const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
  "Access-Control-Max-Age": "86400",
} as const;

export function mcpCorsPreflightResponse() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}

/** HTTP 401 is what Grok (and Claude) use to start the browser login. */
export function mcpUnauthorizedResponse(request: Request) {
  const origin = publicOrigin(request);
  const challenge = mcpWwwAuthenticate(origin);
  return new Response(JSON.stringify({ error: "invalid_token", error_description: "Login required" }), {
    status: 401,
    headers: {
      ...MCP_CORS_HEADERS,
      "WWW-Authenticate": challenge,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function clientName(body: unknown): string {
  const msgs = Array.isArray(body) ? body : [body];
  for (const msg of msgs) {
    const name = (msg as { params?: { clientInfo?: { name?: unknown } } } | null)?.params?.clientInfo?.name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return "";
}

function requestHint(req: Request): string {
  return [
    req.headers.get("user-agent"),
    req.headers.get("x-mcp-client"),
    req.headers.get("origin"),
    req.headers.get("referer"),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Grok Bot / grok.com only start OAuth after a 401 challenge. ChatGPT must keep listing tools without one. */
export function grokNeedsConnectOAuth(req: Request, body?: unknown) {
  return GROK_HINT.test(requestHint(req)) || GROK_HINT.test(clientName(body));
}

export function isMixedAuthClient(req: Request, body?: unknown) {
  return /chatgpt|openai/i.test(`${requestHint(req)} ${clientName(body)}`);
}

export function isToolsCallBody(body: unknown) {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.some((msg) => (msg as { method?: unknown } | null)?.method === "tools/call");
}

/**
 * ChatGPT mixed-auth: public initialize/tools/list.
 * Grok/Claude-style clients: HTTP 401 + WWW-Authenticate starts the login popup.
 * Named clients that are not ChatGPT are OAuth-first (clientInfo only exists on initialize).
 */
export function shouldChallengeMcpOAuth(req: Request, body?: unknown): boolean {
  if (hasBearerToken(req)) return false;
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "DELETE") return true;
  if (isToolsCallBody(body)) return true;
  if (isMixedAuthClient(req, body)) return false;
  if (grokNeedsConnectOAuth(req, body)) return true;
  return Boolean(clientName(body));
}
