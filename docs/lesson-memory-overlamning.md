# Teknisk överlämning: lesson_memory och MCP-instruktioner

**Ansvarig:** Alfredo  
**Gren/PR:** [cursor/lesson-memory-tool-544c](https://github.com/barrettaalfredo-hue/v1-central-context-base-for-LLMS/tree/cursor/lesson-memory-tool-544c) · [PR #30](https://github.com/barrettaalfredo-hue/v1-central-context-base-for-LLMS/pull/30)  
**Uppgift:** Nytt MCP-verktyg `lesson_memory` och uppdaterade minnesinstruktioner  
**Granskad:** 17 september 2026, commit `82999e0`

## Vad jag har gjort

Claude, ChatGPT och Grok hade tre minnesverktyg och fick veta att de skulle spara sparsamt. De kunde inte spara en lärdom som egen typ, och de väntade ofta på att användaren skulle säga “kom ihåg det här”.

Alfredo har lagt till verktyget `lesson_memory` och bytt ut instruktionerna som MCP-servern skickar vid start. Modellen ska söka, spara, uppdatera och lagra lärdomar av sig själv. Inloggning, databas och de tre gamla verktygen fanns redan. Filip har inte byggt ny dashboard-vy för det här.

## Hur fungerar lösningen?

Klienten ansluter till `/api/mcp`. Servern skickar instruktionerna i `initialize.instructions` (`apps/api/lib/mcp-instructions.ts`). Användaren klistrar inte in någon prompt.

Fyra verktyg:

| Verktyg | När | Indata |
| --- | --- | --- |
| `search_memory` | Före svar om tidigare kontext kan spela roll | `project?`, `category?`, `query?`, `offset?` |
| `save_memory` | Ny hållbar sak (faktum, beslut, mål, deadline, preferens) | `project`, `category`, `title`, `content` |
| `update_memory` | Samma sak har ändrats | `id` plus alla fält |
| `lesson_memory` | En lärdom som ska styra framtida arbete | `project`, `title`, `content` |

Det finns inget `create_memory`. Namnet är `save_memory`. Det finns inget `lesson-memory`. Namnet är `lesson_memory`. Det finns inget `delete_memory`. Användaren raderar i dashboarden.

`lesson_memory` anropar `saveLesson` i `@v1/memory`. Servern sätter alltid `category` `lesson`. Klienten skickar inte kategori. `save_memory` nekar `lesson`. Sök och uppdatering tar `lesson`. Dashboardetiketten är Lesson.

Databasregeln `memories_category_check` tillåter `lesson` (redan applicerad på v1-projektet).

## Så kan ni testa

Testmiljö: production-aliaset `https://v1-central-context-base-for-llms.vercel.app/api/mcp` efter merge till `integration/v1.1`. Inte `main`. Inte en unik `-git-` eller hash-URL.

1. Öppna `GET /api/health`. Förväntat: `"mcp":"1.1.0"` och `"lessonMemory":true`.
2. Anslut Claude, ChatGPT eller Grok till samma MCP-adress som tidigare, plus `/api/mcp`. Starta om klienten så nya instruktioner hämtas.
3. Lista verktyg. Förväntat: de fyra namnen ovan. Inget `create_memory`, inget `delete_memory`.
4. Be om något som kan finnas i minnet (“vad bestämde vi?”). Förväntat: `search_memory` före svaret.
5. Låt en metod misslyckas och en bättre metod bli regeln. Förväntat: `lesson_memory` med vad, varför och när. Svaret har `id` och `category` `lesson`.
6. Säg ett vanligt faktum. Förväntat: `save_memory`, inte `lesson_memory`.
7. Ändra samma sak. Förväntat: `update_memory` med samma `id`, ingen dubblett.
8. Filter `category=lesson` i listan. Förväntat: etiketten Lesson.

Felfall: ogiltig `category` på `save_memory` (`lesson` eller `Faktum`) ska felas. Påstådd sparning utan `id` i verktygssvaret är fel. Konto B ska inte se Konto A:s lärdomar.

## Hur har det verifierats?

Automatiskt: `packages/memory` 47 pass. `apps/api` 58 pass, därefter 11 pass på instruktions- och lesson-tester efter textbytet. `apps/dashboard` 24 pass, därefter 3 pass på instruktionstesterna.

Manuellt mot en preview: `GET /api/health` visade `lessonMemory: true`. `tools/list` returnerade de fyra verktygen, inklusive `lesson_memory`.

Inte testat: att Claude, ChatGPT och Grok följer de nya instruktionerna i en riktig chatt efter den senaste textändringen.

## Vad behöver andra veta?

Instruktioner är råd till modellen. Servern tvingar bara kategori och verktygsnamn, inte att sök körs först.

Samma MCP-adress `https://v1-central-context-base-for-llms.vercel.app/api/mcp`. Klistra inte om URL efter merge till `integration/v1.1`. Starta om klienten så instruktionerna laddas om. Unika hash-URL:er (`…gczsl799b…` eller `-git-`) byts vid nästa deploy och ska inte in i dokumentet.

Filip kan filtrera `category=lesson`. Ingen ny radera-knapp ingår här.

Merga till `integration/v1.1`. Inte till `main`.
