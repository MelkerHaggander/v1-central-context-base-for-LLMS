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
| `category` | Endast `fact`, `decision`, `goal`, `deadline` eller `preference` | Claude |
| `title` | Text, 1–150 tecken | Claude |
| `content` | Text, 1–10 000 tecken | Claude |
| `created_at` | UTC, exakt `YYYY-MM-DDTHH:MM:SSZ`. Millisekunder utelämnas | Backend |
| `updated_at` | Samma datumformat | Backend |

Kategorietiketter i dashboarden (svenska):

| `category` | Etikett |
| --- | --- |
| `fact` | Faktum |
| `decision` | Beslut |
| `goal` | Mål |
| `deadline` | Deadline |
| `preference` | Preferens |

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

Argumentnamn och betydelse är låsta. Behörighet: alltid den inloggade användaren, aldrig ett user-id från Claude.

### `save_memory`

In: `{ "project": string, "category": string, "title": string, "content": string }`  
Ut vid lycka: ett minnesobjekt som ovan.  
Ut vid fel: `{ "error": { "code": string, "message": string } }` — får **aldrig** se ut som lyckad sparning.

Identisk omsparning, alltså samma konto plus samma `project`, `category`, `title` och `content`, skapar ingen ny rad. Den returnerar befintlig rad som **lyckat** svar, med oförändrat `id` och oförändrat `updated_at`. Det är inte ett fel.

### `search_memory`

In: `{ "project"?: string, "category"?: string, "query"?: string, "offset"?: number }`  
Ut: lista av minnesobjekt, `updated_at` fallande. Tom lista är giltig, inte fel.  
`query` söker i `title` och `content`.

Högst **50** minnen per anrop. `offset` hoppar över rader i samma sortering, så nästa sida hämtas med `offset: 50`. `offset` måste vara ett heltal 0 eller högre.

`query` matchar delsträng och är skiftlägesokänsligt. Tecknen `%`, `_`, `,`, `(` och `)` tas bort ur `query` före sökning, och blir `query` tom efter det används inget textfilter alls. `project` och `category` matchar exakt och är skiftlägeskänsliga.

### `update_memory`

In: `{ "id": string, "project": string, "category": string, "title": string, "content": string }`  
Ut vid lycka: uppdaterat minnesobjekt (`updated_at` nytt, `id` samma).  
Ut vid fel (finns inte, tillhör annan användare, ogiltiga fält): error-objekt, aldrig ett “lyckat” minne.

`id` måste vara ett UUID. Alla fält krävs, partiell uppdatering finns inte. `updated_at` sätts alltid om, även när inget fält faktiskt ändrats, och raden hamnar då först i sökresultatet.

Om raden inte finns, och om den tillhör ett annat konto, returneras **samma** fel med samma kod och samma text. Felet får inte avslöja om ett `id` existerar.

### Dashboard-HTTP: radera (inte MCP)

Radering finns bara mot den inloggade cookie-sessionen. Claude, ChatGPT och Grok har inget `delete_memory`. MCP-token kan inte radera.

`DELETE /api/memories/:id`

- Inloggad: `{ "success": true }` och header `X-V1-User-Id`
- Inte inloggad: `{ "error": { "code": "UNAUTHENTICATED", "message": "Inte inloggad." } }`, 401
- Ogiltigt `id`: `{ "error": { "code": "INVALID_ID", "message": "id måste vara ett UUID." } }`, 400
- Saknas eller tillhör annat konto: samma `NOT_FOUND` som `update_memory`, 404

Redigera från dashboarden använder samma `PATCH /api/memories/:id` som `update_memory`. Alla fält krävs.

## Hjärnans funktioner (Melker) — samma kontrakt

TypeScript-funktioner som både dashboard-API och MCP anropar efter ihopkoppling:

- validera `category` / längder
- spara (skapar `id` + tidsstämplar via backend/lagring)
- uppdatera via `id`
- radera via `id` (dashboard-HTTP, inte MCP)
- söka (`query`, `project`, `category`, `offset`) med senast uppdaterat först

Exporterade namn: `validateMemoryInput`, `validateSearchInput`, `validateMemoryId`, `saveMemory`, `searchMemory`, `updateMemory`, `deleteMemory`. Det är `searchMemory` i singular, inte `searchMemories`.

De tre huvudfunktionerna tar `user_id` som första argument, hämtat ur anroparens session. Modulen tar aldrig emot `user_id` från verktygsindata och kontrollerar det aldrig mot Claudes inskickade värden, eftersom sådana inte finns.

Simulerad lagring hos Melker och riktig Supabase hos Alfredo ska ge **samma form** på in och ut, och **samma beteende** för sökstädning, skiftläge, tidsstämpelformat, sidstorlek och dubbletter.

## Säkerhet

Konto A får aldrig läsa, uppdatera eller radera Konto B:s minnen, även om minnes-`id` är känt. Tester måste visa det.

Lösenord, nycklar och tokens hör inte i git, inte i Confluence och inte i PR-beskrivningar. Hamnar de där räcker det inte att ta bort dem, kontona måste bytas.
