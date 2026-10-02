# Låsta beslut V1

Enveckasplanen har redan låst det som tidigare var en tom workshop. **Koda inte mot gissningar.** Om något nedan ska ändras måste Filip, Alfredo och Melker vara överens och uppdatera [contracts.md](contracts.md).

## Redan låst

| Sak | Värde |
| --- | --- |
| Produkt | Privat molnminne för Claude Desktop |
| Integration | Måndag 14 september 2026 på branchen `integration/v1`, därefter `main` |
| Hosting | Vercel + Supabase, region Stockholm |
| Språk | TypeScript överallt |
| Claude-koppling | Fjärr-MCP på Vercel, inte lokal server |
| Verktyg | `save_memory`, `search_memory`, `update_memory` |
| Injektion | Instruktioner i Claude-projektet; modellen anropar verktygen |
| Konton | Tre förskapade e-post/lösenord, ingen registrering |
| Åtkomst | RLS / inloggning; aldrig user-id från Claude |
| Minnesfält | `id`, `project`, `category`, `title`, `content`, `created_at`, `updated_at` + `user_id` i DB |
| Kategorier | `fact`, `decision`, `goal`, `deadline`, `preference` |
| Sök | Text i titel/innehåll, filter, `updated_at` desc |
| Dashboard-refresh | Var 10:e sekund + knapp |
| Inte i V1 | Python, worker, kö, Cron, vektordb, ChatGPT, auto-insamling, filer, delade ytor, historik, konflikter |

## Startpaket (måste finnas innan feature-kod)

Redan i repot:

- [ ] Format — [contracts.md](contracts.md)
- [ ] Gemensamma testexempel — [testexempel.md](testexempel.md)
- [ ] Tester av gränssnitten — [torsdag-test.md](torsdag-test.md) + MCP-gränssnitt i contracts
- [ ] Separata kodmappar — `apps/dashboard`, `apps/api`, `packages/memory` med README för leverans

## Fortfarande Alfredos att sätta upp (ingen gissning i kod)

- De tre kontonas riktiga e-postadresser (inte committa lösenord) — [supabase-setup.md](supabase-setup.md)
- Nycklar i Vercel, aldrig i git. URL/ref: `https://your-project.supabase.co`
- Publik MCP-adress till anslutningsguiden
