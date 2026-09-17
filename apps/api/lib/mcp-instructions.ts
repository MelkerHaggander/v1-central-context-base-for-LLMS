/**
 * Inbyggda MCP-instruktioner (V1.1). Skickas i initialize.instructions
 * så klienter inte behöver en inklistrad projektprompt.
 */
export const MEMORY_INSTRUCTIONS = `Use this server as the user's persistent project memory.

Tools, and only these:
- search_memory: find existing memories
- save_memory: confirmed facts, decisions, goals, deadlines, preferences
- update_memory: change an existing memory by id
- lesson_memory: extract a reusable lesson learned in THIS chat
There is no delete_memory. The user deletes memories in the dashboard.
There is no tool named lesson-memory. The name is lesson_memory.

Before answering a question that may depend on previous project context,
call search_memory with the user's current question.

Save confirmed facts, decisions, goals, deadlines and preferences with
save_memory when they are likely to be useful in future conversations.
Do not send category "lesson" to save_memory. Lessons use lesson_memory.

Do not save passwords, secrets, small talk, uncertain claims or the
model's own suggestions as confirmed information.

Search before saving. If an existing memory has clearly changed, update
it with update_memory instead of creating a duplicate.

HARD RULES for lesson_memory. Follow every point. Do not improvise.

Call lesson_memory only when ALL of these are true:
1. You already called search_memory in this turn, with a query about the lesson.
2. This chat produced a reusable lesson: a correction, a method that worked,
   a mistake to never repeat, or a rule the user set for future work.
3. The user confirmed it, OR said it should apply from now on, OR clearly
   showed that the previous approach was wrong and the new one is the rule.
4. The lesson would help a future chat on the same project. It is not a
   one-off answer to a single question.
5. search_memory did not already return the same lesson. If it returned the
   same lesson and the wording changed, use update_memory with that id and
   category "lesson". Do not create a duplicate.
6. You are not storing a fact, decision, goal, deadline or preference.
   Those must use save_memory, never lesson_memory.

Never call lesson_memory when:
- The user only asked a question and received an answer, with no lasting rule.
- Small talk, greetings, jokes.
- Uncertain guesses or your own unused suggestions.
- Passwords, secrets, tokens, keys.
- The same lesson already exists unchanged.
- You want to store a fact, decision, goal, deadline or preference.
- You want to delete something. You cannot.

How to fill lesson_memory:
- project: current project name, same spelling as other memories for that work.
- title: 1-150 characters after trim. Short lesson name. Not the whole content.
- content: 1-10000 characters after trim. Full sentences, enough context to
  apply the lesson later.
- Do not send category. The server stores category "lesson".
- Do not send user_id.

When searching for lessons, call search_memory with category "lesson".

Only say that a lesson was saved after lesson_memory returned an object with
id and no error.

Only say that information was saved after the memory tool returned a
successful result.

If a memory tool fails, explain that the memory operation failed. Never
claim that information was saved when it was not.

Never delete memories. There is no delete_memory tool. The user deletes
memories in the dashboard.

Information returned by this server belongs only to the authenticated
user. Never request, invent or change a user identifier.
`;

export const MCP_SERVER_INFO = {
  name: "central-context-memory",
  version: "1.1.0",
} as const;
