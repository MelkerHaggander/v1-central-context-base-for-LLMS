# Kontrakt v1.2: det Melker bygger hjärnan mot

**Ansvarig för reglerna:** Alfredo
**Branch:** `integration/v1.2-grundläggande`
**Gäller från:** integrationen måndag 5 oktober 2026
**Status:** låst som underlag. Ingen hjärnkod i den här filen.

`integration/v1.1` rörs inte innan 5 oktober. Den här branchen är underlaget för den nya hjärnan. Melker bygger mot de här reglerna. Han hittar inte på en egen modell för miljö, ägare eller MCP.

## Vad en miljö är

Privata och gemensamma minnen ligger i samma tabell, `memories`. Varje minne har ett `space_id` som visar vilket utrymme det tillhör.

Utrymmena sparas i tabellen `spaces`. Där står om utrymmet är personligt eller teamets.

Tabellen `space_members` kopplar användare till utrymmen.

- Alfredo har ett personligt utrymme. Enda medlemmen är Alfredo.
- Teamets gemensamma utrymme har medlemmarna Alfredo, Filip och Melker.

Systemet kontrollerar medlemskapet innan någon får läsa eller ändra minnen. Alla medlemmar har samma rättigheter i sitt utrymme.

## Vem som väljer miljö vid sparning

Språkmodellen väljer inte utrymme.

Användaren skriver i chatten om minnet ska till det gemensamma utrymmet. Om användaren inte skriver det, sätter servern det personliga utrymmet. Det är default. Servern sätter `space_id`.

## Vad en sökning får se

När Alfredo ber Claude göra en uppgift får sökningen hämta från två utrymmen: Alfredos personliga utrymme och teamets gemensamma utrymme.

Den får aldrig hämta från Filips personliga utrymme eller Melkers personliga utrymme. Aldrig ett annat konto.

## Identitet

Nyckeln är `space_id`, projekt, kategori, titel och `md5(content)`.

`space_id` ersätter `user_id` i nyckeln. Samma titel och kategori får finnas i samma utrymme när innehållet är ett annat. Samma titel får också finnas både i det personliga utrymmet och i teamets utrymme, eftersom det är två olika `space_id`.

## Gränsen hjärnan anropar

Hjärnan anropar inte Auth och inte OAuth. Melker ändrar inte RLS.

Servern skickar de `space_id` som just det här anropet får läsa. För Alfredo är det hans personliga utrymme och teamets utrymme. `listNearest` filtrerar på den listan.

RLS släpper bara rader i utrymmen där den inloggade finns i `space_members`. Den regeln skrivs i en migration som Alfredo äger.

Tills `space_id` finns i databasen gäller bara dagens gräns: `user_id` från sessionen.

## Var de gamla versionerna samlas

Den gällande texten ligger kvar på raden i `memories`. Allt som har skrivits över eller tagits bort samlas i en egen tabell, `memory_versions`. En rad där är en händelse, inte ett nytt minne.

Varje uppdatering och varje radering lägger en rad med:

- minnets id
- vem som gjorde det, från inloggningen
- när
- händelsen: `update` eller `delete`
- texten före
- texten efter. Vid radering är texten efter tom

`memory_versions` visas bara för den inloggade användaren på dashboarden. MCP, `get_context` och språkmodellerna får inte historiken. Sökning och vektorerna läser bara den gällande raden i `memories`. En raderad rad finns kvar i historiken på dashboarden och kommer inte med i sökningen.

## Vektorer

Bara den gällande texten blir en vektor. Gamla versioner ligger inte i vektorbasen. De lagras som text i `memory_versions`, så användaren kan se dem på dashboarden.

Melker skriver filen för `pgvector` och embedding-kolumnen. Han kör den inte. Alfredo kör den när v1.2 integreras. Innan dess är den gemensamma databasen oförändrad.

## MCP från 5 oktober

Live-ytan har två verktyg:

- `get_context` tar emot prompten och lämnar tillbaka gällande kontext från den inloggades personliga utrymme och teamets utrymme.
- `save_memory` tar emot en kort text, `brief`. Servern sätter `space_id`. Svaret talar om ifall något blev `written`.

`search_memory`, `update_memory` och `lesson_memory` finns inte på MCP efter bytet.

Radering ingår inte i MCP.

## Adress

Efter integrationen är MCP-adressen densamma:

`https://v1-central-context-base-for-llms.vercel.app/api/mcp`

OAuth-klienterna registreras inte om. Innan 5 oktober pekar adressen kvar på v1.1.
