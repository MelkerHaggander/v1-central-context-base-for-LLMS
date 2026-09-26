# Kontrakt V1 — låst format

Alla tre bygger mot den här filen. Formatet är JSON för informationen och TypeScript för koden. **Ändras bara efter överenskommelse.**

Status: **LÅST** enligt 1-veckasplanen.

Uppdaterad 12 september 2026 med alla tres godkännande: dubblettregel, sidstorlek, sökregler, felkoder, exportnamn och exakt tidsstämpelformat är nu dokumenterade. Inga fält har lagts till, tagits bort eller ändrats. Tilläggen beskriver beteende som körs i Melkers `@v1/memory`.

## Minne (det som dashboard, MCP och hjärnan delar)

Databasen lagrar dessutom `user_id`. `user_id` returneras aldrig i svar till klienten. Ägare = inloggning.

| Fält | Format och regel | Vem fyller i |
| --- | --- | --- |
| `id` | Unikt UUID som text | Backend |
| `project` | Text, 1–100 tecken | Claude |
| `category` | Endast `fact`, `decision`, `goal`, `deadline`, `preference` eller `lesson` | Claude |
| `title` | Text, 1–150 tecken | Claude |
| `content` | Text, 1–10 000 tecken | Claude |
| `created_at` | UTC, exakt `YYYY-MM-DDTHH:MM:SSZ`. Millisekunder utelämnas | Backend |
| `updated_at` | Samma datumformat | Backend |

Kategorietiketter i dashboarden (engelska). Värdena mot API och MCP är oförändrade gemener:

| `category` | Etikett |
| --- | --- |
| `fact` | Fact |
| `decision` | Decision |
| `goal` | Goal |
| `deadline` | Deadline |
| `preference` | Preference |
| `lesson` | Lesson |

### Exempel (svar utan `user_id`)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "project": "Projekt A",
  "category": "deadline",
  "title": "Lanseringsdatum",
  "content": "Vi lanserar 15 oktober 2026.",
  "created_at": "2026-09-10T12:00:00Z",
  "updated_at": "2026-09-10T12:00:00Z"
}
```

Ogiltig `category`, tom `title`, `project` över 100 tecken eller `content` över 10 000 tecken = fel, inget minne sparat.

Fälten trimmas före kontroll, och det trimmade värdet är det som sparas. En `title` med bara blanksteg räknas därför som tom.

Felkoder som får förekomma: `INVALID_PROJECT`, `INVALID_TITLE`, `INVALID_CONTENT`, `INVALID_CATEGORY`, `INVALID_ID`, `INVALID_OFFSET`, `NOT_FOUND`, `INVALID_CREDENTIALS`, `DELETE_FAILED`. Vid flera ogiltiga fält returneras ett enda fel, i ordningen `project`, `title`, `content`, `category`.

## Inloggning

Tre förskapade konton (e-post + lösenord). Ingen registreringsvy i V1.

| Händelse | Exakt format |
| --- | --- |
| Skicka inloggning | `{ "email": "filip@example.com", "password": "…" }` |
| Inloggad användare | `{ "data": { "id": "användarens UUID", "email": "filip@example.com" } }` |
| Inte inloggad | `{ "data": null }` |
| Lyckad utloggning | `{ "data": { "success": true } }` |
| Fel | `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Fel mejl eller lösenord." } }` |

Filips mock och Alfredos riktiga Auth ska följa **samma** JSON utåt mot dashboarden.

## MCP-verktyg (gränssnitt)

Från v1.2 är MCP:s `tools/list` exakt `get_context` och `save_memory`, även i den publika listan före inloggning. `update_memory` och `lesson_memory` är inte MCP-verktyg. Deras HTTP-rutter finns kvar. `search_memory` finns inte i MCP.

Argumentnamn och betydelse är låsta. Behörighet: alltid den inloggade användaren. Modellen skickar aldrig `user_id` eller `space_id`. Servern väljer kategori och om minnet är personligt eller gemensamt.

### `save_memory`

In: `{ "brief": string, "project"?: string, "prompt"?: string }`  
`brief` är 1–10 000 tecken. `prompt` är valfri extraktionskontext och lagras inte rå. De fyra fälten `project`, `category`, `title` och `content` utan `brief` ger `INVALID_CONTENT`.  
Ut vid lycka: `{ "items": [ { "id", "space", "space_id", "project", "category", "title" } ] }` utan `content`. Högst 8 rader. Ogiltiga utkast blir `skipped`.  
Ut vid fel: `{ "error": { "code": string, "message": string } }` — får **aldrig** se ut som lyckad sparning. `FORMULATE_FAILED` skriver ingenting.

Samma ämne (utrymme, projekt, kategori, titel) skriver över innehållet. Varje sådan ändring lägger en rad i `memory_versions` med vem som ändrade, händelsen `update`, text före och text efter. Identisk text skapar ingen ny version och ändrar inte `updated_at`. `source` sätts till `brain` vid skapande och ändras inte vid redigering.

### `get_context`

In: `{ "prompt": string, "project"?: string }`
`prompt` måste vara hela användarens meddelande, 1–8 000 tecken. LLM:en skickar inte `keywords`, `query`, `category` eller `offset`. Högst ett anrop görs före svaret; servern extraherar nyckelord och rankar. `readOnlyHint` är false, eftersom anropet också kan spara.

Ut:

```json
{
  "keywords": ["lansera", "projektet"],
  "project": "Projekt A",
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "project": "Projekt A",
      "category": "deadline",
      "title": "Lanseringsdatum",
      "snippet": "Vi lanserar 15 oktober 2026.",
      "updated_at": "2026-09-20T12:00:00Z",
      "source": "user_memory"
    }
  ],
  "omitted": 0,
  "omitted_duplicate": 0,
  "omitted_capped": 0,
  "written": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "space": "personal",
      "space_id": "660e8400-e29b-41d4-a716-446655440000",
      "project": "Projekt A",
      "category": "decision",
      "title": "Stack"
    }
  ]
}
```

Tom `items` är giltig. Varje träff innehåller bara `id`, `project`, `category`, `title`, en matchcentrerad `snippet`, `updated_at` och `source: "user_memory"`; aldrig `user_id`, `created_at` eller fullt `content`. Snippet-fönstret justeras till ordgränser och tecknen `&` och `<` HTML-escapas. Högst 8 träffar returneras, varje `snippet` är högst 280 tecken och JSON för v1.1-fälten är högst 3 500 tecken. `written` räknas inte in i den gränsen.

`written` har högst 8 poster, utan `content`, med `space` (`personal` eller `shared`) och `space_id`. En formulerare som kastar lämnar `items` kvar och `written` tom. Saknas embedding-kolumnen, eller fallerar embed-anropet vid läsning, används dagens lexikala `getContext`.

`omitted_duplicate` räknar äldre logiska dubbletter och `omitted_capped` relevanta unika träffar som inte fick plats; `omitted` är summan. När `project` saknas kan svaret dessutom innehålla högst åtta kompakta projektnamn i `projects`; det är bara en ledtråd och aldrig en lista över minnen.

Rankningen prioriterar titelträff över innehållsträff, därefter täckning av unika nyckelord, kategori-ledtrådar i prompten och senast uppdaterat som skiljeregel. Korta heltal som `5` behålls för datumfrågor. Svenska böjningssuffix normaliseras lätt och sammansatt prefixmatchning kräver minst sju tecken. En liten svensk/engelsk synonymtabell används för etablerade ord som `databas`/`database` och stammen `lanser`/`lansering`/`launch`. Böjda kategoriord som `beslutet`, `målen`, `tidsfrister`, `lärdomar`, `decisions` och `lessons` känns igen. Kategoriavsikt används som fallback först när inget minne har en riktig lexikal träff, även om prompten har kvar orelaterade ord som `hittills` eller `sparat`. Svaga träffar på enbart projektnamnet tas bort när prompten också innehåller sakord. Av minnen med samma `project`, `title` och `category` returneras bara det senast uppdaterade. Träffar med poäng 0 tas bort. `project` filtreras på hela namnet men skiftlägesokänsligt. Ogiltig eller tom prompt ger `INVALID_PROMPT`; lagringsfel ger `SEARCH_FAILED`.

### `update_memory` (HTTP, inte MCP)

In: `{ "id": string, "project": string, "category": string, "title": string, "content": string, "allow_project_change"?: boolean }`
Ut vid lycka: uppdaterat minnesobjekt (`id` samma).  
Ut vid fel (finns inte, tillhör annan användare, ogiltiga fält): error-objekt, aldrig ett “lyckat” minne.

`id` måste vara ett UUID och får inte vara nil-UUID `00000000-0000-0000-0000-000000000000`. Alla minnesfält krävs; partiell uppdatering finns inte. Identisk text ändrar inte `updated_at` och skriver ingen version. Ändrad `title` eller `content` sätter nytt `updated_at` och sparar en händelse `update`: vem som ändrade, från den inloggade användaren, plus text före och text efter.

Ett ändrat `project` avvisas med `PROJECT_CHANGE_REQUIRES_FLAG` om inte anropet uttryckligen skickar `allow_project_change: true`. Flaggan får bara skickas för ett avsiktligt projektbyte. Ett vanligt minne får inte ändras till `category: "lesson"` via `update_memory`; det ger `LESSON_CATEGORY_REQUIRES_TOOL`. En befintlig lärdom får fortsätta ha `category: "lesson"` när den uppdateras.

Om raden inte finns, och om den tillhör ett annat konto, returneras **samma** fel med samma kod och samma text. Felet får inte avslöja om ett `id` existerar.

### `lesson_memory` (HTTP, inte MCP)

In: `{ "project": string, "title": string, "content": string }`  
Inget `category`. Servern sätter alltid `category`: `lesson`.  
Ut vid lycka: ett minnesobjekt som ovan, med `category` `lesson`.  
Ut vid fel: samma error-objekt som en misslyckad skrivning.

HTTP-rutten finns kvar för lärdomar som skickas med de tre fälten. MCP har inget `lesson_memory`. Servern väljer kategori när modellen anropar `save_memory` med `brief`. Identisk omsparning ändrar inte `updated_at`.

## Dashboard-HTTP (inte MCP)

### Lista och filtrera

`GET /api/memories` och `POST /api/mcp/search_memory` får användas av dashboarden och andra mänskliga gränssnitt, men `search_memory` finns **inte** i MCP:s `tools/list` eller `initialize.instructions`.

In: `{ "space_id": string, "project"?: string, "category"?: string, "query"?: string, "offset"?: number }`
`space_id` krävs. Ett `user_id` från klienten ignoreras. Användaren måste vara medlem i utrymmet, annars 403 `FORBIDDEN`. Saknas `space_id` blir svaret 400 `INVALID_SPACE`. Ut: lista av minnesobjekt i det utrymmet, `updated_at` fallande. Tom lista är giltig, inte fel. `query` söker lexikalt i `title` och `content`. Ingen formulerare och ingen vektorsökning.

Högst **50** minnen per anrop. `offset` hoppar över rader i samma sortering, så nästa sida hämtas med `offset: 50`. `offset` måste vara ett heltal 0 eller högre. `query` matchar delsträng och är skiftlägesokänsligt. Tecknen `%`, `_`, `,`, `(` och `)` tas bort ur `query` före sökning, och blir `query` tom efter det används inget textfilter alls. `project` och `category` matchar exakt och är skiftlägeskänsliga.

### Radera

Radering finns bara mot den inloggade cookie-sessionen. Claude, ChatGPT och Grok har inget `delete_memory`. MCP-token kan inte radera.

`DELETE /api/memories/:id`

- Inloggad: `{ "success": true }` och header `X-V1-User-Id`
- Inte inloggad: `{ "error": { "code": "UNAUTHENTICATED", "message": "Inte inloggad." } }`, 401
- Ogiltigt `id`: `{ "error": { "code": "INVALID_ID", "message": "id måste vara ett UUID." } }`, 400
- Saknas eller tillhör annat konto: samma `NOT_FOUND` som `update_memory`, 404

Redigera från dashboarden använder `PATCH /api/memories/:id` med samma projektbytesflagga och lektionsregler som HTTP-`update_memory`. Alla minnesfält krävs.

Skapa från dashboarden är `POST /api/memories` med `space_id` plus `project`, `category`, `title` och `content`. Ingen formulerare. `source` sätts till `dashboard` bara när raden skapas och ändras inte vid redigering. Embedding räknas på `title`, radbrytning och `content` efter lyckad skrivning. Fallerar embed lämnas vektorn tom och skrivningen är ändå lyckad.

`DELETE /api/memories/:id` tar bort minnet ur sök och ur vektorer. Historiken ligger kvar. Raderingen skriver en händelse `delete` med vem som raderade, text före, och tom text efter.

`GET /api/memories/:id/versions` returnerar textversioner, nyast först, även efter att minnet raderats. Varje post har `version_number`, `memory_id`, `space_id`, `changed_by`, `event` (`update` eller `delete`), `project`, `category`, `title_before`, `title_after`, `content_before`, `content_after`, `source` och `created_at`. Inga vektorer. Bara en medlem i utrymmet får listan. `memory_versions` har ingen `on delete cascade` mot `memories`.

## Hjärnans funktioner (Melker) — samma kontrakt

TypeScript-funktioner som både dashboard-API och MCP anropar efter ihopkoppling:

- validera `category` / längder
- spara (skapar `id` + tidsstämplar via backend/lagring)
- uppdatera via `id`
- radera via `id` (dashboard-HTTP, inte MCP)
- söka (`query`, `project`, `category`, `offset`) med senast uppdaterat först
- extrahera nyckelord och hämta rankad, budgeterad kontext från hela prompten
- formulera `brief` eller en prompt till högst åtta minnesutkast och spara dem i användarens utrymmen
- räkna embedding efter lyckad skrivning och läsa närmaste grannar när vektorn finns

Exporterade namn: `validateMemoryInput`, `validateSearchInput`, `validateMemoryId`, `extractKeywords`, `saveMemory`, `searchMemory`, `searchInSpace`, `getContext`, `updateMemory`, `deleteMemory`, `saveBrief`, `saveDashboardMemory`, `listMemoryVersions`. `createMemoryApi` har dessutom `saveLesson` (samma som `saveMemory` med `category` `lesson`) för HTTP. Det är `searchMemory` i singular, inte `searchMemories`. MCP anropar `getContext` och `saveBrief`.

De tre huvudfunktionerna tar `user_id` som första argument, hämtat ur anroparens session. Modulen tar aldrig emot `user_id` från verktygsindata och kontrollerar det aldrig mot Claudes inskickade värden, eftersom sådana inte finns.

Simulerad lagring hos Melker och riktig Supabase hos Alfredo ska ge **samma form** på in och ut, och **samma beteende** för sökstädning, skiftläge, tidsstämpelformat, sidstorlek och dubbletter.

## Säkerhet

Konto A får aldrig läsa, uppdatera eller radera Konto B:s minnen, även om minnes-`id` är känt. Tester måste visa det.

Lösenord, nycklar och tokens hör inte i git, inte i Confluence och inte i PR-beskrivningar. Hamnar de där räcker det inte att ta bort dem, kontona måste bytas.
