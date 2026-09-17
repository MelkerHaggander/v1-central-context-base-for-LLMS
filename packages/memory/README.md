# `packages/memory/` — Melkers leverans

**Person:** Melker  
**Branch:** `melker/memory`  
**Paket:** `@v1/memory`  
**Stack:** Vanliga **TypeScript-funktioner** (ingen Python, ingen worker, ingen kö, ingen Cron, ingen vektordb)  
**Arbetar självständigt med:** testdata och **simulerad lagring**; bygger regler, sökning och Claude-instruktioner.

Efter integration anropas **samma funktioner** av dashboardens serverkod och av MCP. Alfredo byter anrop. Filip anropar HTTP, inte den här modulen direkt.

## Export

Importera från `@v1/memory`:

- `validateMemoryInput`, `validateSearchInput`, `validateMemoryId`
- `saveMemory`, `searchMemory`, `updateMemory`, `deleteMemory`
- `createMemoryApi`, `createInMemoryStore`, `createSupabaseStore`, `toIso`

`Result<T>` är `{ data: T } | { error: { code, message } }`. Inte ett naket minne. `user_id` är första argumentet, aldrig ett fält i svaret.

```ts
import { createMemoryApi, createSupabaseStore } from "@v1/memory";

const api = createMemoryApi(createSupabaseStore(supabase));
await api.saveMemory(userId, input);
```

`userId` skall vara samma värde som `auth.uid()` i JWT:n som klienten bär. Supabase-adaptern skickar inte `user_id` i insert. Triggern `private.set_memory_defaults` sätter den. In-memory filtrerar `user_id` själv.

## Adapter mot `apps/api` (Alfredos beslut)

Ingen rot-`package.json` och inga workspaces. Root Directory förblir `apps/api`.

1. I `apps/api/package.json`: `"@v1/memory": "file:../../packages/memory"`
2. I `apps/api/next.config.ts`: `transpilePackages: ["@v1/memory"]`
3. Anropsställen som idag importerar `@/lib/memory/store`:
   - `apps/api/app/api/mcp/route.ts`
   - `apps/api/app/api/mcp/save_memory/route.ts`
   - `apps/api/app/api/mcp/search_memory/route.ts`
   - `apps/api/app/api/mcp/update_memory/route.ts`
   - `apps/api/app/api/memories/route.ts`
   - `apps/api/app/api/memories/[id]/route.ts`
4. Därefter radera `apps/api/lib/memory/` så det bara finns en hjärna.

Merga inte PR #13. Den har fel Result-form och fel query-städning.

## Regler som paketet äger

- Validate trimmar före längd och category. Ett fel i ordning project → title → content → category.
- Identisk omsparning (samma konto, project, category, title, `md5(content)`) är lycka: samma `id`, samma `updated_at`. Inte ett fel.
- Sök städar `query` med `replace(/[%_,()]/g, " ").trim()`. Tom efter städ = inget textfilter.
- `query` är skiftlägesokänslig substring i `title` och `content`. `project` och `category` är exakta och skiftlägeskänsliga.
- Sortering `updated_at` fallande. `offset` hoppar rader. Sidstorlek 50.
- Tider ut: `YYYY-MM-DDTHH:MM:SSZ` (millisekunder bort). Update låser `id` och `created_at`, sätter alltid ny `updated_at`.
- Saknad rad och annan ägare ger samma `NOT_FOUND`: `Minnet finns inte eller tillhör ett annat konto.`
- IO-fel behåller Alfredos koder `SAVE_FAILED`, `SEARCH_FAILED`, `UPDATE_FAILED`, `DELETE_FAILED`.
- `deleteMemory` är dashboard-HTTP. MCP har inget radera-verktyg och MCP-token kan inte radera.

## Hur Claude-instruktioner mappar

Texten i [docs/claude-instruktioner.md](../../docs/claude-instruktioner.md) är den kopierbara projekttexten. Den strider inte mot identisk-omsparning-som-lycka.

| Instruktion | Funktion / verktyg |
| --- | --- |
| Hämta relevant projektminne före projektfrågor | `searchMemory` / `search_memory` |
| Spara bekräftade fakta, beslut, mål, deadlines, preferenser | `saveMemory` / `save_memory` med rätt `category` |
| Spara en lärdom från chatten | `saveLesson` / `lesson_memory` (alltid `category` `lesson`) |
| Sök före sparning | Claude anropar `search_memory` först. Identisk `saveMemory` är ändå lycka och skapar inte en andra rad. |
| Uppdatera befintligt ID vid tydlig ändring | `updateMemory` / `update_memory` |
| Bekräfta sparning först efter lyckat verktygssvar | Visa inte “sparat” om svaret har `error` |

Uppdateringsflöde: sök → ta `id` → `updateMemory`. Ingen versionshistorik.

## Tester

```bash
cd packages/memory
npx tsx --test test/**/*.test.ts
```

Fixtures kommer från [docs/testexempel.md](../../docs/testexempel.md). Paritet kör samma vektor mot `createInMemoryStore` och en fake-Supabase-klient (trigger, RLS, `23505`). Inga live-writes.

## Klart på din gren när

- [x] Funktionerna validerar, sparar, uppdaterar, söker enligt kontraktet mot simulerad lagring
- [x] Alla testexempel i `docs/testexempel.md` har automatiska tester som går grönt
- [x] Isolering mellan två `user_id` är testad
- [x] Instruktionstexten är färdig och kopierbar
- [x] Exporten är en TypeScript-modul som Alfredo och Filip kan importera utan att skriva om regler

Måndag mergas den här grenen till **`integration/v1`** (efter Alfredo, före Filip). Inte direkt till `main`.
