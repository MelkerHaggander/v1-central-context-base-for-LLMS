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
import { MockMemoryStore } from "./store";
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

function seed() {
  const rows: Array<Memory & { user_id: string }> = [];
  MOCK_ACCOUNTS.forEach((account, a) => {
    EXAMPLES.forEach((example, i) => {
      const { day, hour, ...fields } = example;
      // Fixed valid v4 UUIDs so a row keeps the same id, and the same spot on the globe.
      const id = `a${a}${String(i).padStart(3, "0")}0000-0000-4000-8000-${String(a * 100 + i).padStart(12, "0")}`;
      const stamp = `2026-09-${String(day).padStart(2, "0")}T${String((hour + a) % 24).padStart(2, "0")}:00:00Z`;
      rows.push({ id, user_id: account.id, ...fields, created_at: stamp, updated_at: stamp });
    });
  });
  return rows;
}

declare global {
  var __dashboardMockStore: MockMemoryStore | undefined;
}

// globalThis so Next dev hot reload does not hand out a fresh empty database.
export const mockDb: MockMemoryStore =
  globalThis.__dashboardMockStore ?? (globalThis.__dashboardMockStore = new MockMemoryStore(seed()));
