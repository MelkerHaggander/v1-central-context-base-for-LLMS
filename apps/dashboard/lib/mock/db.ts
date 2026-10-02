/**
 * Shared mock database, one per server process, seeded per mock account.
 *
 * The three rows from docs/testexempel.md come first and keep their wording,
 * because the Monday test list checks for them by title. The rest exist so the
 * globe has something to be a globe about: several projects and all six
 * categories, which three rows in one project cannot show. Ids are fixed valid
 * v4 UUIDs, so a row keeps its place on the sphere between fetches.
 */
import { MOCK_ACCOUNTS } from "./accounts";
import { MockMemoryStore, type Row } from "./store";
import type { Memory } from "../types";

type Seed = Omit<Memory, "id" | "created_at" | "updated_at"> & { day: number; hour: number };

const EXAMPLES: Seed[] = [
  // docs/testexempel.md, unchanged.
  { project: "Projekt A", category: "deadline", title: "Lanseringsdatum", content: "Vi lanserar 15 oktober 2026.", day: 10, hour: 9 },
  { project: "Projekt A", category: "decision", title: "Stack för V1", content: "V1 kör TypeScript på Vercel och Supabase. Ingen Python-worker.", day: 11, hour: 9 },
  { project: "Projekt A", category: "fact", title: "Tre testkonton", content: "Det finns tre förskapade konton. Ingen offentlig registrering.", day: 12, hour: 9 },

  { project: "Projekt A", category: "goal", title: "Open source before launch", content: "V1.1 is the first public version. The repository goes public once account isolation is proven.", day: 12, hour: 14 },
  { project: "Projekt A", category: "preference", title: "Swedish in handovers, English in product", content: "Handover pages stay in Swedish. Anything a user reads is English.", day: 13, hour: 8 },
  { project: "Projekt A", category: "lesson", title: "Never trust a wrapper", content: "Two docs described the delete response differently. Accept both shapes rather than calling a success a failure.", day: 16, hour: 20 },

  { project: "Boringcontext", category: "decision", title: "One MCP address", content: "Clients paste one fixed /api/mcp address. Deploy hashes change, the address does not.", day: 14, hour: 11 },
  { project: "Boringcontext", category: "fact", title: "Four memory tools", content: "search_memory, save_memory, update_memory, lesson_memory. There is no delete tool.", day: 14, hour: 12 },
  { project: "Boringcontext", category: "decision", title: "Deleting is dashboard only", content: "A language model may write and update, never delete. Deleting needs a logged-in human.", day: 16, hour: 9 },
  { project: "Boringcontext", category: "deadline", title: "V1.1 goals due", content: "Multi-LLM, memory control, isolation and stable errors are due 20 September 14:00.", day: 16, hour: 16 },
  { project: "Boringcontext", category: "goal", title: "Context survives the client", content: "Write in one model, continue in another, and the context is already there.", day: 15, hour: 10 },
  { project: "Boringcontext", category: "lesson", title: "Rotate, do not just delete", content: "A secret that reached a document is spent. Removing the line does not unspend it.", day: 18, hour: 7 },
  { project: "Boringcontext", category: "preference", title: "Plain error text", content: "Every failure shows its code and a sentence a human can act on. No silent retries.", day: 17, hour: 19 },

  { project: "Infra", category: "fact", title: "Functions run in Stockholm", content: "vercel.json pins region arn1 for both apps.", day: 11, hour: 15 },
  { project: "Infra", category: "decision", title: "Shared Supabase, separate Vercel projects", content: "Each person deploys their own branch. All of them read the same database.", day: 15, hour: 18 },
  { project: "Infra", category: "preference", title: "No schema changes without the team", content: "Migrations may be written in a branch. Running one against the shared database needs a decision.", day: 15, hour: 19 },
  { project: "Infra", category: "lesson", title: "Row level security is the real boundary", content: "The anon key is public by design. What keeps accounts apart is the policy, not the key.", day: 17, hour: 9 },

  { project: "Onboarding", category: "fact", title: "No public signup", content: "Accounts are created by hand. The sign-up provider is switched off.", day: 12, hour: 17 },
  { project: "Onboarding", category: "goal", title: "Connect in under two minutes", content: "Paste the address, log in, approve. No prompt to paste anywhere.", day: 16, hour: 11 },
  { project: "Onboarding", category: "deadline", title: "Client walkthrough recorded", content: "A short recording of Claude, ChatGPT and Grok connecting, before the repository goes public.", day: 18, hour: 13 },

  { project: "Research", category: "fact", title: "Duplicate saves are not errors", content: "Saving an identical row again returns the existing row, same id, same updated_at.", day: 13, hour: 20 },
  { project: "Research", category: "goal", title: "Measure what the model actually saves", content: "Count tool calls per session to see whether the instructions change behaviour.", day: 17, hour: 14 },
];

/** Spaces as Alfredo's supabase/manual/20261005_space_members.sql sets them up:
 *  one personal space per account, one shared space with all three. */
export const PERSONAL_SPACE: Record<string, string> = Object.fromEntries(
  MOCK_ACCOUNTS.map((account, a) => [account.id, `5a0e0000-0000-4000-8000-00000000000${a + 1}`]),
);
export const SHARED_SPACE = "5a0e0000-0000-4000-8000-0000000000ff";

type TeamSeed = Seed & { author: number; source: "dashboard" | "brain"; hoursAgo?: number };

/**
 * The team space. A few rows are only hours old at seed time so the 24 hour
 * marker has something to mark, one pair is a near duplicate so the duplicate
 * finder has something to find, and two rows carry history written by a
 * teammate so the history panel can show "who".
 */
const TEAM: TeamSeed[] = [
  { project: "Boringcontext", category: "deadline", title: "Integration v1.2", content: "Alla tre delar ska vara ihopkopplade måndag 5 oktober. Därefter börjar omfattande testning.", day: 22, hour: 9, author: 1, source: "dashboard" },
  { project: "Boringcontext", category: "decision", title: "Embedding model", content: "OpenAI text-embedding-3-large, dimension 3072, cosine. Same model for rows and queries.", day: 26, hour: 10, author: 2, source: "brain" },
  { project: "Boringcontext", category: "decision", title: "Brain model", content: "Always Claude Sonnet 5, temperature 0, fixed JSON schema. Not Opus.", day: 26, hour: 11, author: 2, source: "brain" },
  { project: "Boringcontext", category: "fact", title: "One MCP address", content: "Same MCP address after the integration. No new OAuth clients.", day: 24, hour: 13, author: 1, source: "brain" },
  { project: "Boringcontext", category: "preference", title: "Personal is the default", content: "MCP saves to personal unless the user says yes to the team.", day: 24, hour: 15, author: 1, source: "dashboard" },
  { project: "Boringcontext", category: "goal", title: "Open source plus hosted", content: "Open source code for technical users, a paid hosted service for everyone else.", day: 21, hour: 18, author: 1, source: "dashboard" },
  { project: "Boringcontext", category: "goal", title: "Open source and a hosted plan", content: "The code is open source. Non-technical users pay for a hosted service.", day: 0, hour: 0, author: 2, source: "brain", hoursAgo: 5 },
  { project: "Boringcontext", category: "deadline", title: "Integration day", content: "Monday 5 October: Alfredo runs the migration, then the members file.", day: 0, hour: 0, author: 2, source: "brain", hoursAgo: 3 },
  { project: "Mässa", category: "goal", title: "Ten conversations", content: "Talk to at least ten visitors about scattered project context.", day: 22, hour: 12, author: 1, source: "dashboard" },
  { project: "Mässa", category: "fact", title: "Question list", content: "Spontaneous reaction, concrete situation, what makes you hesitate, what would v1 need.", day: 22, hour: 13, author: 1, source: "dashboard" },
  { project: "Mässa", category: "lesson", title: "Do not pitch first", content: "Ask about their situation before describing the product.", day: 0, hour: 0, author: 0, source: "brain", hoursAgo: 20 },
  { project: "Infra", category: "decision", title: "pgvector in the same database", content: "No separate vector database. One column on memories, filtered by space_id and RLS.", day: 25, hour: 17, author: 2, source: "brain" },
  { project: "Infra", category: "lesson", title: "Empty spaces blind RLS", content: "Run the members file after the migration, or nobody can read anything.", day: 26, hour: 20, author: 2, source: "brain" },
];

function iso(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function seed() {
  const rows: Row[] = [];
  MOCK_ACCOUNTS.forEach((account, a) => {
    EXAMPLES.forEach((example, i) => {
      const { day, hour, ...fields } = example;
      // Fixed valid v4 UUIDs so a row keeps the same id, and the same spot on the globe.
      const id = `a${a}${String(i).padStart(3, "0")}000-0000-4000-8000-${String(a * 100 + i).padStart(12, "0")}`;
      const stamp = `2026-09-${String(day).padStart(2, "0")}T${String((hour + a) % 24).padStart(2, "0")}:00:00Z`;
      rows.push({
        id,
        user_id: account.id,
        space_id: PERSONAL_SPACE[account.id],
        source: i % 3 === 0 ? "dashboard" : "brain",
        ...fields,
        created_at: stamp,
        updated_at: stamp,
      });
    });
  });

  const now = Date.now();
  TEAM.forEach((example, i) => {
    const { day, hour, author, source, hoursAgo, ...fields } = example;
    const id = `b0${String(i).padStart(6, "0")}-0000-4000-8000-${String(900 + i).padStart(12, "0")}`;
    const stamp =
      hoursAgo !== undefined
        ? iso(new Date(now - hoursAgo * 3_600_000))
        : `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
    rows.push({
      id,
      user_id: MOCK_ACCOUNTS[author].id,
      space_id: SHARED_SPACE,
      source,
      ...fields,
      created_at: stamp,
      updated_at: stamp,
    });
  });
  return rows;
}

function build(): MockMemoryStore {
  const rows = seed();
  const store = new MockMemoryStore(rows, [
    ...MOCK_ACCOUNTS.map((account) => ({
      id: PERSONAL_SPACE[account.id],
      kind: "personal" as const,
      members: [account.id],
    })),
    { id: SHARED_SPACE, kind: "shared" as const, name: "Boringcontext", members: MOCK_ACCOUNTS.map((a) => a.id) },
  ], {
    emailOf: (id) => MOCK_ACCOUNTS.find((a) => a.id === id)?.email ?? null,
    idOfEmail: (email) => MOCK_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase())?.id ?? null,
  });

  // History on two team rows, written by different people, so "who" has something to show.
  const deadline = rows.find((r) => r.space_id === SHARED_SPACE && r.title === "Integration v1.2");
  if (deadline) {
    deadline.updated_at = "2026-09-25T08:30:00Z";
    store.seedVersion({
      version_number: 1,
      memory_id: deadline.id,
      space_id: SHARED_SPACE,
      changed_by: MOCK_ACCOUNTS[2].id,
      event: "update",
      project: deadline.project,
      category: deadline.category,
      title_before: deadline.title,
      title_after: deadline.title,
      content_before: "Alla tre delar ska vara ihopkopplade fredag 2 oktober.",
      content_after: "Alla tre delar ska vara ihopkopplade måndag 5 oktober.",
      source: deadline.source ?? null,
      created_at: "2026-09-23T10:00:00Z",
    });
    store.seedVersion({
      version_number: 2,
      memory_id: deadline.id,
      space_id: SHARED_SPACE,
      changed_by: MOCK_ACCOUNTS[0].id,
      event: "update",
      project: deadline.project,
      category: deadline.category,
      title_before: deadline.title,
      title_after: deadline.title,
      content_before: "Alla tre delar ska vara ihopkopplade måndag 5 oktober.",
      content_after: deadline.content,
      source: deadline.source ?? null,
      created_at: "2026-09-25T08:30:00Z",
    });
  }
  const brain = rows.find((r) => r.space_id === SHARED_SPACE && r.title === "Brain model");
  if (brain) {
    brain.updated_at = "2026-09-26T12:00:00Z";
    store.seedVersion({
      version_number: 1,
      memory_id: brain.id,
      space_id: SHARED_SPACE,
      changed_by: MOCK_ACCOUNTS[1].id,
      event: "update",
      project: brain.project,
      category: brain.category,
      title_before: brain.title,
      title_after: brain.title,
      content_before: "Claude Opus for extraction, Sonnet for retrieval.",
      content_after: brain.content,
      source: "brain",
      created_at: "2026-09-26T12:00:00Z",
    });
  }
  return store;
}

declare global {
  var __dashboardMockStoreV12: MockMemoryStore | undefined;
}

// globalThis so Next dev hot reload does not hand out a fresh empty database.
export const mockDb: MockMemoryStore =
  globalThis.__dashboardMockStoreV12 ?? (globalThis.__dashboardMockStoreV12 = build());
