# Teknisk överlämning: Claude och Grok får inget MCP-tillstånd

**Ansvarig:** Alfredo  
**Gren/PR:** `cursor/oauth-release-without-service-role-544c` · https://github.com/barrettaalfredo-hue/BoringContext-Central-intelligence-system-LLMS/pull/37  
**Uppgift:** Kopplingen ska fungera igen för Claude, Grok och ChatGPT utan att byta MCP-adress  
**Granskad:** 21 september 2026

## Vad som var fel

Lösenordsinloggningen fungerade. Dashboarden fungerade. MCP-adressen svarade och listade de fyra verktygen.

Felet kom i steget direkt efter inloggningen. Claude öppnade inloggningsfönstret, lösenordet godkändes, och servern sparade en engångskod. Sedan skulle servern lösa in koden och ge klienten ett MCP-tillstånd. Det anropet fick 401 från databasen. Koden blev kvar oanvänd. Ingen ny MCP-session skapades. Claude visade `Authorization with v1.1 minne failed`. Grok använder samma steg och kom inte åt MCP.

Tre anrop i loggen, i den ordningen, klockan 17:42 och 17:45 den 21 september:

1. Inloggning med lösenord: status 200.
2. `oauth_save_code`: status 204. Koden sparades.
3. `oauth_exchange_code`: status 401. Inlösningen nekades.

## Varför det blev så

PKCE-ändringen den 20 september ersatte `oauth_consume_code` med `oauth_exchange_code`. Bara `service_role` får anropa den nya funktionen. Servern anropar den med värdet i `SUPABASE_SERVICE_ROLE_KEY`.

Databasen accepterar inte det värdet som `service_role`. Hälsokontrollen säger bara att variabeln inte är tom. Den säger inte att nyckeln har rätt roll.

Samma typ av fel hände den 18 september, när session-funktionerna låstes till `service_role`. Då rättades det genom att sessionen skapas med den inloggade användarens egen nyckel. PKCE-ändringen lade tillbaka ett anrop som kräver `service_role`, på just inlösningen.

`oauth_exchange_code` ska inte öppnas för den publika nyckeln. Den tar emot PKCE-challenge, och den challenge syns redan i inloggningsadressen. Den som ser både adressen och koden i redirecten skulle då kunna hämta tokens utan `code_verifier`.

## Lösningen

Inloggningsfönstret är oförändrat. MCP-adressen är oförändrad:

`https://v1-central-context-base-for-llms.vercel.app/api/mcp`

När användaren godkänner skapas MCP-tillståndet direkt, med användarens egen inloggning. Det anropet fungerar redan. Supabase-tokens sparas i sessionen, inte i koden som klienten sedan löser in.

När Claude, Grok eller ChatGPT byter koden anropar servern `oauth_release_mcp_tokens` med den vanliga anon-nyckeln. Funktionen tar `code_verifier`, räknar samma S256-hash som appen, och raderar koden bara om kod, klient, redirect och hash stämmer. Den lämnar ut MCP-tokens. Den lämnar inte ut Supabase-tokens. Fel verifier förbrukar inte koden.

Claude, Grok och ChatGPT använder alla det här steget. Därför räcker samma rättelse för de tre. Kimi ingår inte.

## Så publicerar ni rättelsen

Gör det i den här ordningen.

1. Öppna Supabase, projekt `v1-central-context-base`, SQL Editor.
2. Klistra in hela filen `supabase/migrations/20260921190000_oauth_release_mcp_tokens.sql`. Ingenting annat. Inte en testlogg.
3. Kör den.
4. Merga branchen `cursor/oauth-release-without-service-role-544c` till `integration/v1.1`.
5. Vänta tills den vanliga adressen har den nya koden. Byt inte MCP-adress. Klistra inte in en unik Vercel-länk.
6. Ta bort den gamla connectorn i Claude och i Grok. Skapa den igen mot samma adress och logga in en gång. Gör samma sak i ChatGPT om den kopplingen också fallerade.

Tills både SQL och den nya koden är ute fortsätter kopplingen att falla. Dashboarden påverkas inte.

## Så kan ni testa

1. Claude: koppla samma MCP-adress. Inloggningen ska sluta med ett godkänt tillstånd, inte `Authorization with v1.1 minne failed`.
2. Verktygen ska vara `search_memory`, `save_memory`, `update_memory`, `lesson_memory`.
3. Säg att ni lanserar den 15 oktober 2026, projekt Projekt A. Raden ska synas i dashboarden.
4. Ny chatt: "När lanserar vi?" Claude ska söka och svara med datumet.
5. Byt datumet till 22 oktober. Samma rad ska uppdateras.
6. Be om en lärdom. Den ska synas som Lesson.
7. Grok: samma adress, samma konto, kopplingen ska bli godkänd.
8. ChatGPT: samma adress. Authentication = Mixed. När minnet används ska inloggningen bli godkänd.

## Hur det har verifierats

Hashen i SQL är samma som i appen. För texten `test-verifier-value` blir båda `R-yFp3ykg184xTSr9BXHiHtbqWZXIG_H4B3K5EWSDzM`.

Automatiska tester i `apps/api` kontrollerar att fel verifier inte förbrukar koden, att koden bara kan användas en gång, att en rad utan MCP-tokens inte lämnas ut, och att `oauth_exchange_code` fortfarande inte är öppen för anon.

Inte verifierat förrän SQL är körd och branchen är mergad: en ny koppling från Claude, Grok och ChatGPT mot den vanliga adressen.

## Vad andra behöver veta

Byt inte MCP-adress. Ändra inte lösenord. Radera inte konton.

Den gamla funktionen `oauth_exchange_code` finns kvar och är fortfarande bara för `service_role`. Den används inte av den nya koden. Rätta inte felet genom att ge anon rätt att anropa den.
