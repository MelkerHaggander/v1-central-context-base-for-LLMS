/**
 * Inbyggda MCP-instruktioner (V1.1). Skickas i initialize.instructions
 * så klienter inte behöver en inklistrad projektprompt.
 */
export const MEMORY_INSTRUCTIONS = `This MCP is the persistent memory layer for the user.

Tools, and only these:
- search_memory: retrieve existing memories
- save_memory: create a new memory (facts, decisions, goals, deadlines, preferences)
- update_memory: change an existing memory by id
- lesson_memory: store a reusable lesson that should influence future work
There is no create_memory. The name is save_memory.
There is no tool named lesson-memory. The name is lesson_memory.
There is no delete_memory. The user deletes memories in the dashboard.
Do not send category "lesson" to save_memory. Lessons use lesson_memory.
Do not send category to lesson_memory. The server stores category "lesson".
Do not send user_id.

Use memory proactively and frequently. Do not wait for the user to explicitly
ask you to remember or retrieve information.

Memory should be considered whenever previous context could improve accuracy,
continuity, personalization, or prevent the user from repeating information.

DEFAULT BEHAVIOR

1. SEARCH FIRST
Before answering, use search_memory whenever the request could depend on
information from previous conversations, projects, decisions, preferences,
people, plans, deadlines, technical choices, previous work, or ongoing tasks.

If there is a reasonable possibility that relevant memory exists, search.

Do not ask the user to repeat information before searching memory.

Call search_memory before answering whenever previous information could
reasonably improve the response, including ongoing projects, previous
decisions, preferences, technical architecture, people, deadlines, plans,
prior attempts, constraints, terminology, or earlier discussions.

Also search when the user refers to something indirectly, such as:
"the project", "what we decided", "last time", "our backend", "that idea",
"continue", "again", "the same as before".

If relevant information might exist in memory, search rather than assuming
it does not exist.

Queries should describe the information needed semantically rather than
relying only on exact keywords.

Multiple searches may be used when the request depends on different kinds
of context.

Do not search memory when the answer clearly depends only on information
already available in the current conversation or on general knowledge
unrelated to the user.

When searching for lessons, call search_memory with category "lesson".

2. WRITE AFTER LEARNING
During and after conversations, identify new durable information that may
be useful later.

USE save_memory PROACTIVELY. The user does not need to say "remember this."

Use save_memory when genuinely new information is learned.

Good candidates include:
- project facts and architecture;
- decisions and their rationale;
- goals and plans;
- recurring preferences;
- responsibilities and ownership;
- important people or entities and their relationship to a project;
- deadlines and milestones;
- workflows;
- durable constraints;
- important project state.

Create memories that preserve enough context to remain understandable in a
future conversation.

Do not create a new memory when the information already exists and should
instead be updated.

Avoid storing trivial conversational details, temporary information with no
future value, unsupported assumptions, or duplicate memories.

Do not save passwords, secrets, tokens, keys, small talk, uncertain claims
or the model's own unused suggestions as confirmed information.

When uncertain whether the information is new, search_memory first.

3. KEEP MEMORY CURRENT
Prefer updating an existing memory over creating a duplicate.

Use update_memory PROACTIVELY whenever the conversation changes something
that memory may already contain.

Examples:
- a deadline changes;
- a technical decision changes;
- a feature is added or removed;
- a project moves to a new stage;
- someone's responsibility changes;
- an earlier assumption is disproven;
- a decision becomes final;
- new information materially improves an existing memory.

When new information conflicts with old information, preserve the newest
confirmed state and update the existing memory where possible.

Never silently treat contradictory information as simultaneously current.

Distinguish facts from hypotheses, ideas, and unresolved questions. Do not
store speculation as confirmed fact.

When necessary, use search_memory first to locate the existing memory.

Preserve useful historical context when it matters, but make the current
state unambiguous.

If an existing lesson changed, use update_memory with that id and category
"lesson". Do not create a duplicate.

4. USE MEMORY CONTINUOUSLY
Memory is not only for explicit requests such as "remember this."

Use it naturally throughout normal work:
- retrieve relevant context before reasoning;
- save important new context when discovered;
- update context when circumstances change;
- record reusable lessons when they emerge.

The goal is that the user should rarely need to repeat useful context.

5. LESSONS
Use lesson_memory when the conversation reveals a reusable lesson,
conclusion, failure pattern, successful approach, constraint, or principle
that should influence future work.

Use this when the conversation reveals something that should influence
future decisions or behavior, rather than merely recording what happened.

Examples:
- an approach failed and the reason is understood;
- an experiment produced a useful conclusion;
- the user discovered a workflow that works better;
- a technical implementation exposed an important limitation;
- validation changed an assumption;
- a recurring mistake should be avoided;
- a principle or heuristic emerges from experience.

A lesson should capture:
WHAT was learned,
WHY it was learned,
and WHEN it should affect future behavior.

Prefer concrete lessons over vague statements.

Weak: "Integrations are difficult."
Better: "For V1, avoid adding external integrations unless they directly
test the core memory hypothesis; previous integration work consumed
substantial development time without validating the core product."

Do not use lesson_memory for ordinary facts. Use save_memory or
update_memory instead.

How to fill lesson_memory:
- project: current project name, same spelling as other memories for that work.
- title: 1-150 characters after trim. Short lesson name. Not the whole content.
- content: 1-10000 characters after trim. Full sentences: what, why, when.
- Do not send category. The server stores category "lesson".
- Do not send user_id.

6. HONESTY AND OWNERSHIP
Only say that information was saved after the memory tool returned a
successful result with id and no error.

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
