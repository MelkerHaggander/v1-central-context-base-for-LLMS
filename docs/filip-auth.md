# Filip: koppla dashboard-vyerna till Alfredos auth

Gäller från **måndag 14 september** när `alfredo/integrations` mergas in i `integration/v1`. Samma JSON som [contracts.md](contracts.md). Cookies måste följa med (`credentials: "include"`).

Base URL: Vercel-preview för `alfredo/integrations` (Root Directory `apps/api`).

| Vy | Anrop |
| --- | --- |
| Inloggningsformulär | `POST /api/auth/login` body `{ "email", "password" }` |
| App-skal / “är jag inloggad?” | `GET /api/auth/session` |
| Logga ut | `POST /api/auth/logout` |
| Minneslista / sök / filter | `GET /api/memories?project=&category=&query=&offset=` (`category=lesson` är Lärdom) |
| Redigera minne | `PATCH /api/memories/:id` body `{ "project", "category", "title", "content" }` → uppdaterat minnesobjekt. Alla fält krävs. Cookie-session, inte MCP. |
| Radera minne | `DELETE /api/memories/:id` → `{ "success": true }`. Finns **inte** som MCP-verktyg. Bara inloggad användare. |

Lyckad login: `{ "data": { "id", "email" } }`  
Fel lösen: `{ "error": { "code": "INVALID_CREDENTIALS", "message": "Fel mejl eller lösenord." } }`  
Inte inloggad: `{ "data": null }`

OAuth-godkännandevyn för Claude är `/oauth/authorize`. Alfredo äger auth bakom. Filip får byta utseendet på den sidan, inte flödet.

Redigera och radera kräver samma cookie som listan (`credentials: "include"`). Svaret har header `X-V1-User-Id`. Konto B som anropar PATCH/DELETE på A:s `id` får `NOT_FOUND` med samma text som en saknad rad. Dashboard-UI:t för knapparna byggs inte här — bara API-kontraktet.
