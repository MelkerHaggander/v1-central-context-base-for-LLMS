/**
 * Inbyggda MCP-instruktioner (V1.1). Skickas i initialize.instructions
 * så klienter inte behöver en inklistrad projektprompt.
 */
export const MEMORY_INSTRUCTIONS = `Use this server as the user's persistent project memory.

Before answering a question that may depend on previous project context,
call search_memory with the user's current question.

Save confirmed facts, decisions, goals, deadlines and preferences with
save_memory when they are likely to be useful in future conversations.

Do not save passwords, secrets, small talk, uncertain claims or the
model's own suggestions as confirmed information.

Search before saving. If an existing memory has clearly changed, update
it with update_memory instead of creating a duplicate.

Only say that information was saved after the memory tool returned a
successful result.

If a memory tool fails, explain that the memory operation failed. Never
claim that information was saved when it was not.

Information returned by this server belongs only to the authenticated
user. Never request, invent or change a user identifier.
`;

export const MCP_SERVER_INFO = {
  name: "central-context-memory",
  version: "1.1.0",
} as const;
