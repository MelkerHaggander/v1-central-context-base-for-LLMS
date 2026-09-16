import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMemoryApi, createSupabaseStore } from "@v1/memory";
import { z } from "zod";
import {
  memoryAuthRequiredResult,
  withChatGptToolList,
} from "@/lib/mcp-chatgpt";
import { MEMORY_INSTRUCTIONS, MCP_SERVER_INFO } from "@/lib/mcp-instructions";
import {
  mcpCorsPreflightResponse,
  mcpUnauthorizedResponse,
  shouldChallengeMcpOAuth,
} from "@/lib/mcp-oauth-challenge";
import { isPublicMcpHandshake, isPublicMcpBody } from "@/lib/mcp-public-handshake";
import { mcpOrigin, runMcpRequest } from "@/lib/mcp-request-context";
import { createMcpTokenStore } from "@/lib/oauth/mcp-memory-store";
import { getMcpSession } from "@/lib/oauth/sessions";
import { createSupabaseUserClient } from "@/lib/supabase/clients";

const READ_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

const WRITE_TOOL = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
} as const;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonTool(result: { data?: unknown; error?: { code: string; message: string } }) {
  if (result && "error" in result && result.error) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: JSON.stringify({ error: result.error }) }],
    };
  }
  if (result && "data" in result && result.data !== undefined) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result.data) }],
    };
  }
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code: "SAVE_FAILED", message: "Kunde inte spara minnet." } }),
      },
    ],
  };
}

function userClient(extra: { authInfo?: AuthInfo }) {
  const token = extra.authInfo?.token;
  if (!token) throw new Error("UNAUTHENTICATED");
  return createSupabaseUserClient(token);
}

function mcpUserId(extra: { authInfo?: AuthInfo }) {
  const id = extra.authInfo?.extra?.userId;
  if (typeof id !== "string" || !id) throw new Error("UNAUTHENTICATED");
  return id;
}

function memoryApi(extra: { authInfo?: AuthInfo }) {
  const mcpAccess = extra.authInfo?.extra?.mcpAccess;
  if (typeof mcpAccess === "string" && mcpAccess) {
    return createMemoryApi(createMcpTokenStore(mcpAccess));
  }
  return createMemoryApi(createSupabaseStore(userClient(extra)));
}

async function runMemoryTool(
  extra: { authInfo?: AuthInfo },
  run: (userId: string) => Promise<{ data?: unknown; error?: { code: string; message: string } }>,
) {
  try {
    return jsonTool(await run(mcpUserId(extra)));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return memoryAuthRequiredResult(mcpOrigin());
    }
    throw error;
  }
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "save_memory",
      "Spara ett minne för den inloggade användaren. Use this when the user confirms a fact, decision, goal, deadline or preference that should persist across chats.",
      {
        project: z.string().min(1).max(100),
        category: z.enum(["fact", "decision", "goal", "deadline", "preference"]),
        title: z.string().min(1).max(150),
        content: z.string().min(1).max(10_000),
      },
      WRITE_TOOL,
      async (input, extra) => runMemoryTool(extra, (userId) => memoryApi(extra).saveMemory(userId, input)),
    );

    server.tool(
      "search_memory",
      "Sök den inloggade användarens minnen. Tom lista är giltig. Use this before answering questions that may depend on saved project context.",
      {
        project: z.string().max(100).optional(),
        category: z.enum(["fact", "decision", "goal", "deadline", "preference"]).optional(),
        query: z.string().optional(),
        offset: z.number().int().min(0).optional(),
      },
      READ_TOOL,
      async (input, extra) => runMemoryTool(extra, (userId) => memoryApi(extra).searchMemory(userId, input)),
    );

    server.tool(
      "update_memory",
      "Uppdatera ett befintligt minne som tillhör den inloggade användaren. Use this when an existing memory has clearly changed, instead of creating a duplicate.",
      {
        id: z.string().uuid(),
        project: z.string().min(1).max(100),
        category: z.enum(["fact", "decision", "goal", "deadline", "preference"]),
        title: z.string().min(1).max(150),
        content: z.string().min(1).max(10_000),
      },
      WRITE_TOOL,
      async (input, extra) => runMemoryTool(extra, (userId) => memoryApi(extra).updateMemory(userId, input)),
    );
  },
  {
    serverInfo: MCP_SERVER_INFO,
    instructions: MEMORY_INSTRUCTIONS,
  },
  { basePath: "/api", disableSse: true, maxDuration: 60 },
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined;

  const session = await getMcpSession(bearerToken);
  if (session) {
    return {
      token: bearerToken,
      scopes: ["memory"],
      clientId: session.user_id,
      extra: { userId: session.user_id, mcpAccess: bearerToken },
    };
  }

  const supabase = createSupabaseUserClient(bearerToken);
  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data.user) return undefined;
  return {
    token: bearerToken,
    scopes: ["memory"],
    clientId: data.user.id,
    extra: { userId: data.user.id, email: data.user.email },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: false,
  requiredScopes: ["memory"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
});

/** ChatGPT lists tools before OAuth. Grok only starts login after HTTP 401. */
async function mcpRoute(req: Request) {
  return runMcpRequest(req, async () => {
    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await req.clone().json();
      } catch {
        body = undefined;
      }
    }

    if (shouldChallengeMcpOAuth(req, body)) {
      return mcpUnauthorizedResponse(req);
    }

    if (body !== undefined ? isPublicMcpBody(body) : await isPublicMcpHandshake(req)) {
      return withChatGptToolList(await handler(req));
    }
    return withChatGptToolList(await authHandler(req));
  });
}

export { mcpRoute as GET, mcpRoute as POST, mcpRoute as DELETE };
export { mcpCorsPreflightResponse as OPTIONS };
