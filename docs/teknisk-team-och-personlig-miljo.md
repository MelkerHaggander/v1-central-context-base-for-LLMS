# Teknisk överlämning: personlig miljö och teammiljö

**Ansvarig:** Alfredo
**Gren/PR:** https://github.com/barrettaalfredo-hue/BoringContext-Central-intelligence-system-LLMS/pull/40 · **Uppgift:** ingen separat uppgiftslänk
**Granskad:** 26 september 2026, commit `bbecb19`

## Vad jag har gjort

Alfredo har byggt listan som talar om vilka minnesplatser den inloggade personen är med i. Filips växel fanns inte och är inte byggd här.

En radering lämnar en historikrad. Den visar vem som raderade och texten som togs bort. Raden finns kvar efter att minnet är borta, för både den personliga platsen och teamets plats. Bara en medlem i den platsen kan läsa den. MCP kan inte läsa den.

Tabellerna för platser och medlemskap fanns redan i Melkers okörda fil `supabase/migrations/20260926120000_v12_brain_vectors.sql`. Den filen är inte körd och är inte ändrad.

## Hur fungerar lösningen?

En inloggad person anropar `GET /api/spaces`. Servern läser medlemskapet i `space_members` och platsens sort i `spaces`. Koden ligger i `apps/api/app/api/spaces/route.ts` och `apps/api/lib/spaces-http.ts`.

Svaret är en lista. Varje rad har ett id och sorten `personal` eller `shared`. Den egna platsen kommer före teamets plats. Ett annat kontos personliga plats kommer inte med. Webbläsaren skickar inte med något användar-id.

`supabase/manual/20261005_space_members.sql` skapar en personlig plats för `alfredo.test@example.com`, `filip.test@example.com` och `melker.test@example.com`, och en gemensam plats med alla tre. Filen gör inget `DELETE`.

## Så kan ni testa

1. Testmiljö: lokal kod på branchen `cursor/team-och-person-miljo-544c`. Ingen gemensam databas.
2. I `apps/api`, kör `npm test`.
3. Förväntat resultat: alla tester gröna, inklusive `test/spaces-http.test.ts`.
4. Felfall som testerna täcker: tom lista när personen saknar platser, och att Filips personliga plats inte följer med i Alfredos lista.
5. Kör inte SQL-filerna. Efter integrationen körs först Melkers migrationsfil, sedan medlemsfilen. Logga in som Alfredo och anropa `GET /api/spaces`. Förväntat: en personlig plats och den gemensamma platsen.

## Hur har det verifierats?

Automatiskt test: `apps/api` `npm test` kördes 26 september 2026. 110 tester, 0 fel. 7 av dem ligger i `test/spaces-http.test.ts`.

Inte testat mot den gemensamma databasen. Medlemsfilen är inte körd. Dashboardens växel är inte byggd. Live-adressen är inte ändrad.

## Vad behöver andra veta?

Filip kan bygga växeln mot `GET /api/spaces`. Medlemsfilen måste köras efter Melkers migrationsfil, annars finns inte tabellerna. `integration/v1.1` och live-adressen rörs inte före 5 oktober. Inga lösenord eller nycklar ligger i filerna.
