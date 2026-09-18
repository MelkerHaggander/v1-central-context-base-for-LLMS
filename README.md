# v1-central-context-base-for-LLMS

Privat molnminne för **Claude Desktop**. Claude sparar och hämtar via tre MCP-verktyg. Varje konto ser bara sitt eget minne.

TypeScript. **Vercel** + **Supabase** (Stockholm). Ingen Python, worker, kö, Cron eller vektordatabas.

Hur man loggar in och kopplar Claude står i Confluence, inte här.

## Live — gren `integration/v1.1`

Ett Vercel-projekt. Root Directory är `apps/api`. Inte `main` (404). Inte ett andra projekt. Inte Root Directory `apps/dashboard`.

| Vad | Adress |
| --- | --- |
| Dashboard | https://v1-central-context-base-for-llms.vercel.app |
| MCP | `https://v1-central-context-base-for-llms.vercel.app/api/mcp` |
| Vercel | https://vercel.com/barrettaalfredo-hues-projects/v1-central-context-base-for-llms |

MCP-adressen är production-aliaset. Den byts **inte** när ni mergar till `integration/v1.1`. Klistra inte in unika `-git-` eller hash-URL:er.

`main` rörs inte förrän [docs/torsdag-test.md](docs/torsdag-test.md) är grön.

## Kod

| Mapp | Ägare | Vad |
| --- | --- | --- |
| `apps/api/` | Alfredo | Auth, API, fjärr-MCP. Visar också Filips UI (`/`, `/dashboard`, `/anslut`) |
| `apps/dashboard/` | Filip | UI-källa (komponenter). Live-ytan är `apps/api` |
| `packages/memory/` | Melker | Spara, söka, uppdatera. Samma funktioner för dashboard och MCP |

```
Claude Desktop  ↔  fjärr-MCP (Vercel)  ↔  @v1/memory  ↔  Supabase
                                              ↑
                                     Dashboarden läser samma rader
```

Daglig kod: `alfredo/integrations`, `filip/dashboard`, `melker/memory`. Ihopkoppling: `integration/v1.1`.

## Kontrakt

Tre verktyg: `save_memory`, `search_memory`, `update_memory`. Ägare = inloggning, aldrig ett id Claude skickar.

Kategorier: `fact`, `decision`, `goal`, `deadline`, `preference`. Format: [docs/contracts.md](docs/contracts.md). Testdagens Claude-block (byte-låst): [docs/claude-instruktioner.md](docs/claude-instruktioner.md).

Tre förskapade konton, ingen publik registrering. Env: [docs/supabase-setup.md](docs/supabase-setup.md).
