# Integration och test på `integration/v1`

Tester körs på branchen **`integration/v1`**, inte på `main`.
Mergeordning: Alfredo → Melker → Filip. Hur ni mergar: [integration-v1.md](integration-v1.md).
Filnamnet är historiskt.

Varje test nedan är skrivet för att fånga en **faktisk** felväg från jämförelsen Melker ↔ Alfredo ↔ Filip den 12/9. Inte generella smoke-tester.

## Fynd som styr testerna (kort)

- Melkers `types.ts` och `validate.ts` är byte-identiska med `apps/api/lib/memory/` på `origin/alfredo/integrations`.
- Result-form i paketet: `{ data: T } | { error: { code, message } }`. Alfredo `jsonTool` gör `JSON.stringify(result.data)` vid lycka. Ett naket Memory ger texten `undefined`.
- Alfredo anropar idag `saveMemory(supabase, input)`. Paketet tar `userId` först. Alfredo skall byta anrop. Paketet byter inte tillbaka.
- HTTP `GET /api/memories` returnerar en **JSON-lista**, inte `{ "data": [...] }`. Login returnerar `{ "data": { id, email } }`. Filip spricker om listan läses som login.
- MCP-lycka är naket objekt eller lista i verktygstexten. Inte `{ data: ... }`.
- MCP-Zod nekar ogiltig `category` **före** `INVALID_CATEGORY`. HTTP-POST når hjärnan och ger `INVALID_CATEGORY`.
- `query` städas med `replace(/[%_,()]/g, " ").trim()`. Tom efter städ = inget textfilter, alltså en sida med allt.
- `project` och `category` är exakta och skiftlägeskänsliga. `Projekt a` missar `Projekt A`.
- Identisk omsparning är lycka: samma `id`, samma `updated_at`. Unikt index `(user_id, project, category, title, md5(content))`.
- `createSupabaseStore` insertar utan `user_id` (trigger). `listByUser` ignorerar userId-argumentet (RLS). Integrationskrav: `userId === auth.uid()`.
- Claude-verktygen har inget `user_id`-fält.
- `origin/filip/dashboard` hade 12/9 **bara docs** (ingen Next-app). Tester mot dashboard skall då underkännas som Filips yta, inte som trasig hjärna.
- Alfredos testsida `/` är **inte** Filips dashboard. Den visar rå `category` (`deadline`), inte svensk etikett.
- Vercel Root Directory skall förbli `apps/api`. Alfredo skall sätta `"@v1/memory": "file:../../packages/memory"` och `transpilePackages: ["@v1/memory"]`. Ingen rot-`package.json`.
- Lösen till testkontona läcker i klartext på Alfredos gren-README. Anon-nyckel läcker som hårdkodad fallback i `apps/api/lib/supabase/env.ts`. Återge dem inte här. Byt konton om läckan räknas som allvarlig.

## Förutsättningar innan ni börjar

- [ ] `alfredo/integrations` är mergad först in i `integration/v1`
- [ ] `melker/memory` är mergad därefter
- [ ] `filip/dashboard` är mergad sist, eller test 14-16 är redan underkända som Filips yta
- [ ] Tre förskapade konton i Supabase Auth. Lösen **inte** i git, inte i den här filen, inte i PR
- [ ] Supabase i Stockholm, Vercel-backend i Stockholm (`arn1`)
- [ ] Preview för `integration/v1` (inte `main`)
- [ ] Blocket i [claude-instruktioner.md](claude-instruktioner.md) är inklistrat **exakt** i Claude-projektet
- [ ] Fjärr-MCP-URL pekar på **den** previewens `/api/mcp`

Konto A, B och C = de tre förskapade kontona. Vilket mail som är vems står hos Alfredo, utanför den här filen.

---

## Test 1. Preview hittar `@v1/memory`

**Syfte:** Fånga att Alfredo glömde `file:` + `transpilePackages` efter Melker-merge.
**Vem:** Alfredo.
**Yta om det failar:** Alfredo (build). Hjärnan kan vara grön lokalt ändå.
**Förberedelse:** Senaste deploy av `integration/v1`. Build-logg i Vercel.

**Steg**
1. Öppna Vercel-projektet för det här repot.
2. Bekräfta Root Directory = `apps/api`. Inte repo-roten. Inte `apps/dashboard`.
3. Öppna build-loggen för `integration/v1`-preview.
4. Bekräfta att `apps/api/package.json` på den mergade branchen har `"@v1/memory": "file:../../packages/memory"`.
5. Bekräfta att `apps/api/next.config.ts` har `transpilePackages: ["@v1/memory"]`.
6. Anropa `GET /api/health` eller öppna `/` på preview. Sidan skall inte vara 404 från `main`.

**Lycka:** Build grön. Preview svarar. Ingen `Cannot find module '@v1/memory'`. Ingen transpile-krasch på `packages/memory`.
**Underkänt:** Build röd med saknad modul. Preview är fortfarande `main` (404). Root Directory har ändrats. Alfredo anropar fortfarande `@/lib/memory/store` **och** `@v1/memory` samtidigt (två hjärnor).

---

## Test 2. Alfredo bytte anropssignatur

**Syfte:** Fånga `saveMemory(supabase, input)` mot paketets `saveMemory(userId, input, store)`.
**Vem:** Alfredo, Melker granskar diff.
**Yta om det failar:** Alfredo (anrop). Inte `types.ts` / `validate.ts`.
**Förberedelse:** Diff `integration/v1` mot `alfredo/integrations` för filerna nedan.

**Steg**
1. Öppna varje anropsställe som idag importerar `@/lib/memory/store`:
   - `apps/api/app/api/mcp/route.ts`
   - `apps/api/app/api/mcp/save_memory/route.ts`
   - `apps/api/app/api/mcp/search_memory/route.ts`
   - `apps/api/app/api/mcp/update_memory/route.ts`
   - `apps/api/app/api/memories/route.ts`
   - `apps/api/app/api/memories/[id]/route.ts`
2. Förväntat mönster:

```ts
import { createMemoryApi, createSupabaseStore } from "@v1/memory";
const api = createMemoryApi(createSupabaseStore(supabase));
await api.saveMemory(userId, input);
```

3. `userId` skall vara `auth.uid()` från session / OAuth. Inte ett fält från Claude.
4. `jsonTool` skall fortfarande ta hela `Result`. Alltså `jsonTool(await api.saveMemory(...))`. Inte `jsonTool(result.data)` och inte `jsonTool(nakedMemory)`.
5. `apps/api/lib/memory/` skall vara borta efter bytet, eller oanvänd. En hjärna.

**Lycka:** Alla sex filer anropar paketet med `userId` först. `jsonTool` får `{ data }` eller `{ error }`.
**Underkänt:** Första argumentet är fortfarande `SupabaseClient`. TypeScript-fel tystade. `jsonTool` får naket minne (då blir MCP-text `undefined`). PR #13-form är tillbaka.

---

## Test 3. Inloggning, tre konton, fel mail

**Syfte:** Session-JSON som Filip och Claude-OAuth båda behöver.
**Vem:** Alla. Alfredo äger API. Filip äger dashboard-formuläret.
**Yta om det failar:** Fel JSON eller fel lösen-check = Alfredo. Ingen inloggningsvy = Filip.
**Förberedelse:** Lösen från lösenordshanterare, inte från git.

**Steg**
1. `POST /api/auth/login` med giltigt Konto A. Body `{ "email", "password" }`. Cookies skall följa med (`credentials: "include"`).
2. Förväntat: `{ "data": { "id": "<uuid>", "email": "<samma mail>" } }`.
3. `GET /api/auth/session` i samma cookie-session: samma `data`.
4. `POST /api/auth/login` med fel lösen: `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Fel mejl eller lösenord." } }`. Ingen session.
5. Upprepa steg 1 för Konto B och Konto C.
6. På Filips dashboard: samma tre konton kan logga in. Ingen registreringsvy.

**Lycka:** Tre konton in. Fel lösen ger exakt koden ovan. `data` är inte ett minne.
**Underkänt:** Lösen i klartext i testanteckningar eller PR. Dashboard saknas: underkänn test 14, inte det här API-steget. Inloggning returnerar naket user-objekt utan `data` (då spricker Filip som följer contracts).

---

## Test 4. MCP-lycka är naket objekt, inte `data` och inte `undefined`

**Syfte:** Fånga fel Result-form mot `jsonTool` i `apps/api/app/api/mcp/route.ts`.
**Vem:** Melker + Alfredo.
**Yta om det failar:** Alfredo (`jsonTool` / anrop). Paketet skall fortfarande returnera `{ data: Memory }`.
**Förberedelse:** Claude Desktop mot preview `/api/mcp`, inloggad som Konto A. Instruktionerna inklistrade.

**Steg**
1. I en ny chatt: be Claude spara Lanseringsdatum enligt [testexempel.md](testexempel.md).
2. Öppna verktygssvaret för `save_memory` (råtext).
3. Texten skall vara ett JSON-objekt som **börjar med** `{` och innehåller `"id"`, `"project"`, `"title"`, `"content"`, `"created_at"`, `"updated_at"`.
4. Texten skall **inte** vara `{ "data": { ... } }`.
5. Texten skall **inte** vara `undefined`.
6. Nyckeln `user_id` skall inte finnas.
7. `created_at` / `updated_at` skall matcha `YYYY-MM-DDTHH:MM:SSZ` (inga millisekunder).

**Lycka:** Naket minne med UUID och Z-tid. Claude säger sparat **efter** det svaret.
**Underkänt:** `undefined`. Tom text. Bara `{ data: ... }`. `user_id` i svaret. Claude säger sparat innan verktyget svarat.

---

## Test 5. Samma rad via MCP och via HTTP

**Syfte:** Dashboard och Claude skall se samma hjärna, inte stub + paket.
**Vem:** Alfredo kör HTTP. Melker jämför fält. Filip visar sedan samma id.
**Yta om det failar:** Olika id för samma spar = två hjärnor (Alfredo). HTTP 401 = Alfredo auth.
**Förberedelse:** `id` från test 4. Inloggad som Konto A i webbläsaren mot samma preview.

**Steg**
1. `GET /api/memories` med Konto A-cookie. **Ingen** query.
2. Rå body skall vara en JSON-**lista** `[...]`. Inte `{ "data": [ ... ] }`.
3. Ett element skall ha **samma** `id` som MCP-`save_memory` just returnerade.
4. `title` = `Lanseringsdatum`. `content` = `Vi lanserar 15 oktober 2026.`. `project` = `Projekt A`. `category` = `deadline`.
5. `POST /api/mcp/search_memory` eller Claude `search_memory` med `{ "query": "oktober" }` skall ge samma `id`.
6. Alfredos testsida `/` (rubrik "Inte Filips dashboard") skall visa samma title. Det räcker **inte** som godkänt dashboard-test. Se test 14.

**Lycka:** Ett id, tre ytor (MCP, HTTP, testsida).
**Underkänt:** HTTP-lista tom men MCP lyckades (session-cookie / annat konto). Body är `{ data: [...] }` och ni "fixar" genom att ändra paketet. Paketet skall inte ändra HTTP-omslag. Filip skall tåla lista. Alfredo `jsonOk(result.data)` är den låsta HTTP-formen idag.

---

## Test 6. Identisk omsparning skapar inte två rader

**Syfte:** Unikt index + `23505` + `findIdentical` skall vara lycka.
**Vem:** Melker (regel) + Alfredo (DB-index / adapter).
**Yta om det failar:** Två rader = DB-index eller adapter. Claude som sparar två gånger är **inte** underkänt så länge en rad finns.
**Förberedelse:** Lanseringsdatum finns för Konto A.

**Steg**
1. Claude eller `POST /api/memories` med **exakt** samma project, category, title, content. Även med extra blanksteg runt title/content (hjärnan trimmar).
2. Svaret skall ha samma `id` som förut.
3. `updated_at` skall vara oförändrad.
4. `GET /api/memories?query=Lanseringsdatum` skall ge **en** rad, inte två.
5. Claude skall enligt instruktionerna söka först. Om den ändå sparar identiskt: behandla som lycka, inte som fel.

**Lycka:** En rad. Samma id. Samma `updated_at`.
**Underkänt:** Två rader med samma title+content. `SAVE_FAILED` på identisk omsparning. `updated_at` hoppar utan att fälten ändrats (då var det en UPDATE, inte identisk insert).

---

## Test 7. Ogiltig category: två vägar, ingen rad, ingen "sparat"

**Syfte:** Zod på MCP ≠ validate på HTTP. Claude får inte ljuga.
**Vem:** Melker (instruktioner + validate). Alfredo (MCP-schema + HTTP). Claude-operatör.
**Yta om det failar:** Rad skapad = hjärna/HTTP. Claude säger sparat utan id = instruktion / modell (Melkers text, operatörens klistra-in).
**Förberedelse:** Räkna rader för Konto A före testet (`GET /api/memories`).

**Steg**
1. HTTP `POST /api/memories` som Konto A med `category`: `nope`, övriga fält som Lanseringsdatum. Förväntat: `{ "error": { "code": "INVALID_CATEGORY", "message": "category måste vara fact, decision, goal, deadline, preference eller lesson." } }`. Status 400. Ingen ny rad.
2. HTTP `POST` med `category`: `Deadline` (versalt). Samma fel. Ingen rad. Exakt match krävs.
3. I Claude: be den spara med category `anteckning` eller `Faktum`. Verktyget skall felas (schema eller `INVALID_CATEGORY`).
4. Läs vad Claude **skriver** till användaren. Den skall säga att det inte sparades. Inte "sparat", "klart", "ligger i databasen".
5. `GET /api/memories` igen: samma antal rader som före steg 1.

**Lycka:** Error ut. Noll nya rader. Claude ljuger inte.
**Underkänt:** Rad med `nope` eller `Deadline`. Claude bekräftar lycka. Dashboard visar en påhittad lyckad lista.

---

## Test 8. Miss-query är tom lista, inte fel

**Syfte:** `finns-inte-xyz` är giltig sök. Tom `[]` är lycka.
**Vem:** Melker (sökregel). Alfredo (HTTP/MCP-transport). Filip (tom lista i UI).
**Yta om det failar:** `SEARCH_FAILED` på miss = Alfredo transport eller paket-IO. UI som visar felbanner på `[]` = Filip.

**Steg**
1. Claude `search_memory` med `{ "query": "finns-inte-xyz" }`.
2. Verktygssvaret skall vara `[]`. Inte `{ "error": ... }`. Inte `{ "data": [] }` i MCP-texten.
3. HTTP `GET /api/memories?query=finns-inte-xyz` skall vara `[]` med status 200.
4. Filips dashboard: tom träff syns som tom lista, inte som `INVALID_*` och inte som föregående lista kvar utan förklaring.

**Lycka:** Tom lista, 200, ingen error-kod.
**Underkänt:** 400/500. Claude säger "sökningen kraschade" på tom träff. Dashboard återanvänder mock-raderna Lanseringsdatum / Stack för V1 / Tre testkonton när API gav `[]`.

---

## Test 9. Skiftläge och städning som spräcker fel klient

**Syfte:** `Projekt a` är inte `Projekt A`. `%oktober%` skall ändå träffa. Bara `%_()` skall inte filtrera.
**Vem:** Melker (regler). Alfredo om DB-sök fortfarande är `ilike` utan städ (då kan `,` `(` `)` knäcka PostgREST `.or(...)`).
**Yta om det failar:** Efter Melker-merge körs filter i paketet på rader från `listByUser`. Då är detta Melker. Före merge, Alfredos `ilike`.

**Steg**
1. `GET /api/memories?project=Projekt%20A` som Konto A: minst Lanseringsdatum.
2. `GET /api/memories?project=Projekt%20a`: `[]`. Inte 400.
3. `GET /api/memories?query=Oktober`: Lanseringsdatum (content har oktober).
4. `GET /api/memories?query=%25oktober%25` (alltså `%oktober%`): fortfarande Lanseringsdatum. `%` skall ha städats bort.
5. `GET /api/memories?query=%25_()%2C` (bara specialtecken): **inte** tomt om kontot har rader. Inget textfilter.
6. `GET /api/memories?category=deadline`: Lanseringsdatum. `category=Deadline`: `INVALID_CATEGORY` (HTTP) eller `[]` skall **inte** tystas till fel etikett.

**Lycka:** Steg 2 tomt. Steg 3-4 träff. Steg 5 ofiltrerad sida.
**Underkänt:** `Projekt a` träffar. `%oktober%` blir `SEARCH_FAILED` (ofstädad `ilike` / `.or`). Bara specialtecken ger tom lista trots att rader finns. Claude tror att skräpqueryn matchade alla rader och "bekräftar" fel innehåll.

---

## Test 10. Update: samma id, ny tid, låst created_at

**Syfte:** Partiell PATCH-body utan alla fält skall inte tyst lyckas. `NOT_FOUND`-texten är låst.
**Vem:** Melker (updateMemory). Alfredo (PATCH-rutt + MCP).
**Yta om det failar:** Ny rad i stället för update = Claude utan id (instruktion) eller fel verktyg. Fel text på `NOT_FOUND` = paket / Alfredo store.

**Steg**
1. Claude söker fram Lanseringsdatum. Kopierar `id`.
2. `update_memory` med samma project/category/title och `content`: `Vi lanserar 22 oktober 2026.`
3. Svaret: samma `id`. Ny `updated_at`. Samma `created_at`.
4. `GET /api/memories?query=oktober`: **en** rad, ny text. Inte gammal + ny.
5. `PATCH /api/memories/<id>` som Konto A med samma body: `updated_at` nyare igen.
6. `PATCH` med `id` som inte finns: `{ "error": { "code": "NOT_FOUND", "message": "Minnet finns inte eller tillhör ett annat konto." } }`. Status 404.
7. Claude utan att söka, med påhittat id: skall inte påstå lycka.

**Lycka:** Ett id. En rad. Låst `NOT_FOUND`-text.
**Underkänt:** Två deadlines. `created_at` ändrad. `NOT_FOUND` som avslöjar "tillhör annan användare" med annan text än saknad rad. Naket minne i felsvar.

---

## Test 11. Konto B ser inte Konto A

**Syfte:** RLS + samma feltext. `listByUser` i paketet litar på RLS. Fel `userId`-argument får inte läcka om JWT är B.
**Vem:** Alfredo (RLS, JWT). Melker om in-memory används i prod (skall inte).
**Yta om det failar:** Läckt rad = Alfredo RLS / fel Supabase-klient (service_role i user-väg).
**Förberedelse:** Konto A har Lanseringsdatum. Inte kör mot service_role i browsern.

**Steg**
1. Logga ut. Logga in som Konto B mot samma preview.
2. `GET /api/memories`: listan skall **inte** innehålla Konto A:s `id`.
3. Claude som Konto B: `search_memory` `{ "project": "Projekt A" }` skall inte visa A:s rad.
4. `PATCH /api/memories/<A:s id>` som B, giltig body: samma `NOT_FOUND` och samma message som test 10 steg 6.
5. A:s rad oförändrad (logga in som A och läs content).
6. Valfritt: `apps/api/scripts/ab-test.mjs` med lösen i env, inte i git. OK-rad: `Konto B ser inte och kan inte uppdatera Konto A:s minne.`

**Lycka:** B ser `[]` eller bara B:s rader. Samma `NOT_FOUND`.
**Underkänt:** B ser A. B får 200 på PATCH. Olika feltext för saknad vs annan ägare. Dashboard inloggad som B visar A:s mock-fixtures.

---

## Test 12. Sidstorlek 50 och sort

**Syfte:** `range(from, from+49)` hos Alfredo och `slice(offset, offset+50)` i paketet skall ge samma kontrakt.
**Vem:** Melker + Alfredo.
**Yta om det failar:** Fler än 50 i ett svar = sökregel. Fel ordning = sort.

**Steg**
1. Om kontot har färre än 51 rader: spara tillfälliga unika fact-rader via HTTP tills 51 finns, eller hoppa och markera "ej kört, för få rader".
2. `GET /api/memories?offset=0`: högst 50. Första raden har högst `updated_at`.
3. `GET /api/memories?offset=50`: nästa sida, ingen överlapp på `id` med sidan 0 om det finns fler än 50.
4. `GET /api/memories?offset=-1` eller `offset=1.5`: `INVALID_OFFSET`.

**Lycka:** 50 / nästa sida / ogiltig offset är fel.
**Underkänt:** Hela tabellen i ett svar. `offset` ignoreras. Nyaste ligger sist.

---

## Test 13. Claude följer instruktionerna (verktyg, category, id)

**Syfte:** Instruktionstexten är riskfaktorn. Modellen kan strunta i den. Testet underkänner beteendet, inte "känslan".
**Vem:** Melker (text). Operatör (klistra exakt). Alfredo (verktygen finns).
**Yta om det failar:** Fel verktygsnamn eller inga verktyg = Alfredo MCP. Fel beteende trots rätt verktyg = instruktion / modell. Inte paketbugg.

**Steg**
1. Bekräfta att projektinstruktionen är **byte-lik** blocket i [claude-instruktioner.md](claude-instruktioner.md). Inte den gamla enradaren ensam.
2. Ny Claude-chatt. Skriv: `Vad vet du om lanseringsdatum i Projekt A?` Skriv **inte** "sök i minnet".
3. Förväntat: Claude anropar `search_memory` (singular) före svaret. `project` är `Projekt A` om den filtrerar.
4. Skriv: `Kom ihåg att vi lanserar 15 oktober 2026 i Projekt A.`
5. Förväntat: `search_memory` före `save_memory` eller `update_memory`. `category` = `deadline`. `title` nära `Lanseringsdatum`. Inget `user_id` i anropet.
6. Om raden fanns: `update_memory` med riktigt `id`, eller ingen write. Inte en andra identisk rad.
7. Skriv: `Ändra lanseringen till 22 oktober 2026.`
8. Förväntat: sök, sedan `update_memory` med samma `id`. Inte `save_memory` som skapar ny deadline-rad med annan title om samma ämne redan finns.
9. Skriv ett lösen eller en påhittad API-nyckel och be den spara. Claude skall vägra `save_memory` för hemligheten.

**Lycka:** Rätt verktyg, rätt category, riktigt id, ingen hemlighet sparad.
**Underkänt:** Claude anropar inte. Claude hittar på id. Claude skickar `category: "Deadline"`. Claude säger sparat utan verktyg. Hemlighet ligger som rad (radera den ur DB efteråt, byt nyckel).

---

## Test 14. Filips dashboard visar samma rad som Claude just sparade

**Syfte:** Det här är Filips leverans. Alfredos testsida `/` räknas inte.
**Vem:** Filip. Melker och Alfredo bara som vittnen.
**Yta om det failar:** Filip. **Inte** Melkers paket, så länge test 4-5 gick igenom.

**Förberedelse**
- Om `apps/dashboard/` bara har README och ingen Next-app: **stanna här och underkänn**. Skriv "dashboard-kod saknas på `filip/dashboard`". Kör inte om test 4-5 som om hjärnan vore trasig.
- Dashboard deployad eller `npm run dev` mot samma API-preview. `credentials: "include"`.

**Steg**
1. Öppna Filips app, inte `apps/api` `/`.
2. Logga in som Konto A (samma mail som Claude).
3. Be Claude spara (eller återanvänd) **Stack för V1** från [testexempel.md](testexempel.md). Notera `id` från MCP.
4. Vänta högst 10 sekunder **eller** tryck uppdateringsknappen.
5. Listan skall visa title `Stack för V1`, svensk etikett **Beslut** (inte `decision`), project `Projekt A`, samma `id` som MCP.
6. Sök i dashboarden på `TypeScript`. Radens content skall synas.
7. Filter kategori Deadline skall visa Lanseringsdatum som **Deadline**, inte gömma den.
8. Tom sök `finns-inte-xyz` i dashboarden: tom lista, inte mock.

**Lycka:** Samma id som Claude. Svensk etikett. Refresh 10 s eller knapp.
**Underkänt:** Ingen app. Mock-id som inte matchar MCP. Lista tom men test 5 hade raden (då läser UI troligen `body.data` på en topplista). Alfredos testsida används som bevis. Etikett `decision` i UI. 2-sekunderspoll från Alfredos sida räknas inte som Filips 10-sekunderskrav.

---

## Test 15. Dashboard-isolering A/B

**Syfte:** UI får inte visa andras rader, inte heller hårdkodade fixtures för fel konto.
**Vem:** Filip (UI). Alfredo om API läcker (då har test 11 redan fallit).
**Yta om det failar:** API läcker = Alfredo. API rent men UI visar fixtures = Filip.

**Steg**
1. I Filips dashboard: logga ut från A. Logga in som B.
2. Listan skall inte innehålla A:s `id` från test 4 eller 14.
3. Sök `oktober` som B: inte A:s Lanseringsdatum.
4. Om B aldrig sparat: tom lista är rätt. Inte de tre exempelraderna från mock.

**Lycka:** B ser bara B.
**Underkänt:** A:s rader hos B. Mock alltid synlig oavsett konto.

---

## Test 16. Anslutningsguide och OAuth-vy (Filip)

**Syfte:** V1-featuren "koppla Claude" skall gå att klicka i dashboarden.
**Vem:** Filip (UI). Alfredo (URL och `/oauth/authorize`).
**Yta om det failar:** Ingen guide = Filip. Authorize 404 = Alfredo.

**Steg**
1. I Filips dashboard: hitta anslutningsguiden.
2. MCP-adressen som visas skall vara preview för `integration/v1` + `/api/mcp`. Inte `main`-URL. Inte en död preview-hash.
3. Instruktionstexten som kan kopieras skall vara blocket i [claude-instruktioner.md](claude-instruktioner.md), inte den gamla enradaren.
4. OAuth-vy: samma inloggade konto som dashboarden. Inte ett påhittat konto.

**Lycka:** Kopierbar MCP-URL + aktuell instruktion + OAuth samma konto.
**Underkänt:** Guide saknas. URL till tom `main`. Gammal enradare. Dashboard saknas: underkänn som Filip här, inte som Melker.

---

## Test 17. Alla tre testexempel syns efter Claude-spar

**Syfte:** Fixtures är kontrakt, inte bara enhetstester i `packages/memory`.
**Vem:** Alla.
**Yta om det failar:** En rad saknas i HTTP men finns i MCP = transport. Saknas i dashboard men finns i HTTP = Filip. Claude sparade fel category = instruktion (test 13).

**Steg**
1. Som Konto A, via Claude, spara de tre raderna i [testexempel.md](testexempel.md) om de inte redan finns.
2. `GET /api/memories?project=Projekt%20A`: minst de tre titlarna `Lanseringsdatum`, `Stack för V1`, `Tre testkonton`.
3. Senast uppdaterad först.
4. Filips dashboard (om test 14 inte redan underkänd): samma tre titlar, svenska etiketter Deadline / Beslut / Faktum.

**Lycka:** Tre rader, rätt etiketter hos Filip.
**Underkänt:** Bara Alfredos testsida visar dem. Dashboard visar engelska nycklar. En title stavas om så sök `oktober` missar.

---

## Test 18. `main` orörd och inte production

**Syfte:** Torsdag-test godkänns på `integration/v1` först. Sedan `main`.
**Vem:** Alla.
**Yta om det failar:** Den som mergade till `main` för tidigt.

**Steg**
1. Öppna `https://v1-central-context-base-for-llms.vercel.app` eller production-alias.
2. Den skall **inte** vara den godkända V1-ytan innan alla tester här är godkända. Tom `main` / 404 är förväntat nu.
3. Claude-connector skall inte peka på production-`main`.
4. Git: `main` har inte fått merge från `integration/v1` ännu.

**Lycka:** Production är inte V1. Tester kördes på preview för `integration/v1`.
**Underkänt:** `main` är live med halvfärdig merge. Claude pekar på 404-host och "funkar inte" blandas ihop med hjärnfel.

---

## När V1 är levererad

Alla tester 1-18 är godkända av de tre personerna **på `integration/v1`**.
Test 14-16 får inte skippas genom att peka på Alfredos `/`.
Först då mergas `integration/v1` till `main`. Inte förr.
