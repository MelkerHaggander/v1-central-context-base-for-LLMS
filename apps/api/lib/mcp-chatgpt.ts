/** ChatGPT mixed-auth: list tools without a token, OAuth only when calling them. */

import { mcpWwwAuthenticate } from "@/lib/mcp-oauth-challenge";

export { mcpWwwAuthenticate };

export const CHATGPT_OAUTH_SCHEMES = [{ type: "oauth2" as const, scopes: ["memory"] }];

export function memoryAuthRequiredResult(origin: string) {
  const challenge = mcpWwwAuthenticate(origin);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: { code: "UNAUTHENTICATED", message: "Logga in för att använda minnet." },
        }),
      },
    ],
    _meta: {
      "mcp/www_authenticate": [challenge],
    },
  };
}

function injectMessage(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(injectMessage);
  if (!payload || typeof payload !== "object") return payload;
  const msg = payload as { result?: { tools?: Array<Record<string, unknown>> } };
  if (!Array.isArray(msg.result?.tools)) return payload;
  return {
    ...msg,
    result: {
      ...msg.result,
      tools: msg.result.tools.map((tool) => ({
        ...tool,
        securitySchemes: CHATGPT_OAUTH_SCHEMES,
      })),
    },
  };
}

/** MCP SDK strips unknown tool fields. Put ChatGPT securitySchemes back on tools/list. */
export function injectToolSecuritySchemes(payload: unknown): unknown {
  return injectMessage(payload);
}

export async function withChatGptToolList(res: Response): Promise<Response> {
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = injectToolSecuritySchemes(await res.json());
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(body), { status: res.status, headers });
  }
  if (type.includes("text/event-stream")) {
    const text = await res.text();
    const next = text.replace(/^data:\s*(.*)$/gm, (_full, json: string) => {
      try {
        return `data: ${JSON.stringify(injectToolSecuritySchemes(JSON.parse(json)))}`;
      } catch {
        return `data: ${json}`;
      }
    });
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(next, { status: res.status, headers });
  }
  return res;
}
