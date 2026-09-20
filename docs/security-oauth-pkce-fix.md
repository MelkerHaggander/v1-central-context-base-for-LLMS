# Teknisk överlämning: OAuth PKCE-byte stängt mot publika RPC:er

**Ansvarig:** Alfredo
**Gren:** `cursor/oauth-pkce-exchange-544c`
**Uppgift:** Tokenutbytet ska inte kunna kringgå PKCE via `oauth_consume_code`
**Granskad:** 20 september 2026

## 1. Vilken sårbarhet som fanns

`public.oauth_consume_code(p_code text)` är `SECURITY DEFINER` och var körbar med den publika anon-nyckeln. Ett anrop raderade raden i `private.oauth_codes` **bara utifrån authorization code** och returnerade användarens Supabase `access_token` och `refresh_token`.

## 2. Varför den tidigare PKCE-kontrollen kunde kringgås

PKCE-jämförelsen fanns i `apps/api/app/oauth/token/route.ts` **efter** RPC-anropet. Next.js-servern kunde därför bara neka ett redan förbrukat byte. En klient som hoppade över `/oauth/token` och anropade PostgREST direkt fick tokens utan `code_verifier`. Senare migrationer (`20260918120000`, `20260918153000`) låste sessions-RPC:er, inte den här funktionen. I live-projektet `uthkzkvpkkpzrmzjunqq` hade `anon`, `authenticated` och `service_role` fortfarande `EXECUTE` på `oauth_consume_code`.

## 3. Hotmodell

En angripare behövde:

- den publika anon-nyckeln (den finns i klientbyggen och i `apps/api/lib/supabase/env.ts`);
- en giltig authorization code (läckt redirect, referrer, logg eller en annan process som ser `?code=`).

Angriparen kunde då få den inloggade användarens Supabase-session. Med den kan minnen läsas och skrivas som den användaren. MCP-token från `/oauth/token` krävdes inte.

Angriparen behövde inte lösenordet, inte `code_verifier` och inte `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Hur den nya lösningen fungerar

1. `/oauth/authorize` och `/oauth/approve` är oförändrade för användaren. Godkännandet sparar fortfarande koden med PKCE-challenge via `oauth_save_code` (inloggad användar-JWT).
2. `/oauth/token` kräver `code_verifier`, räknar S256-challenge med `pkceChallenge` och anropar `oauth_exchange_code` via `createSupabaseAdminClient`.
3. Databasen raderar raden bara om code, `client_id`, `redirect_uri`, challenge och `expires_at > now()` matchar i **samma** `DELETE ... RETURNING`.
4. Funktionsrätt: endast `service_role`. `oauth_consume_code` tas bort.

## 5. Före- och efterflöde

**Före**

Klient → `POST /oauth/token` (eller direkt PostgREST) → `oauth_consume_code(code)` raderar raden och lämnar ut Supabase-tokens → Next.js jämför verifier (för sent, och bara om anropet gick via Next.js).

**Efter**

Klient → `POST /oauth/token` med `code` + `code_verifier` + `client_id` + `redirect_uri` → servern hashar verifier → `oauth_exchange_code(...)` som `service_role` → match raderar och returnerar bara `user_id`, `access_token`, `refresh_token` → servern utfärdar MCP-tokens som tidigare. Miss matchar noll rader; koden ligger kvar.

## 6. Filer och databasfunktioner

| Del | Ändring |
| --- | --- |
| `supabase/migrations/20260920180000_oauth_exchange_code_pkce.sql` | Ny. Droppar `oauth_consume_code`, skapar `oauth_exchange_code`. |
| `apps/api/lib/oauth/store.ts` | `consumeCode` bort. `exchangeAuthorizationCode` med admin-klient. |
| `apps/api/lib/oauth/authorization-code.ts` | Obligatorisk verifier, challenge, `invalid_grant`. |
| `apps/api/app/oauth/token/route.ts` | Samma HTTP-svar och CORS. Ingen PKCE efter consume. |
| Tester | `lib/oauth/authorization-code.test.ts`, `test/oauth-exchange-lock.test.ts` |

Oändrat för användaren: `/oauth/authorize`, `/oauth/approve`, Connect-sidan, MCP-verktyg, `packages/memory`.

## 7. Miljövariabler

Krävs på Vercel för API-projektet, **inte** `NEXT_PUBLIC_`:

- `SUPABASE_URL` eller `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_ANON_KEY` (befintlig, för login/register)
- `SUPABASE_SERVICE_ROLE_KEY` (tokenutbytet)

Saknas service-role-nyckeln kastar `createSupabaseAdminClient` `Missing SUPABASE_SERVICE_ROLE_KEY`. Token-endpointen svarar `server_error` och loggar bara `oauth_token_misconfigured`. Nyckeln loggas inte. Kontroll: `GET /api/health` → `"serviceRoleSet": true`.

## 8. Hur migrationen appliceras

Ändra inte gamla migrationer. Kör den nya SQL-filen mot projektet `uthkzkvpkkpzrmzjunqq` (SQL Editor eller `supabase db push` från denna gren).

Ordning: **SQL först, sedan deploy av `apps/api` till `integration/v1.1`.** SQL stänger hålet direkt. Gammal API-kod som fortfarande anropar `oauth_consume_code` slutar fungera tills den nya koden är ute. Gör de två stegen i samma fönster.

## 9. Verifiering

Lokalt, i `apps/api`:

```bash
npm test
npx eslint app/oauth/token/route.ts lib/oauth/store.ts lib/oauth/authorization-code.ts
npm run build
```

I Supabase, efter SQL:

```sql
select has_function_privilege('anon', 'public.oauth_exchange_code(text,text,text,text)', 'EXECUTE');
-- false
select has_function_privilege('authenticated', 'public.oauth_exchange_code(text,text,text,text)', 'EXECUTE');
-- false
select has_function_privilege('service_role', 'public.oauth_exchange_code(text,text,text,text)', 'EXECUTE');
-- true
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'oauth_consume_code';
-- noll rader
```

I Vercel: health `serviceRoleSet: true`. Connect med Claude, ChatGPT eller Grok mot samma MCP-adress. Inloggningsformuläret är detsamma. Efter godkännande ska klienten få tokens utan ny URL.

## 10. Måste interna användare ansluta MCP igen?

Nej, inte om de redan har en fungerande MCP-session. Den här ändringen raderar inte `private.oauth_sessions`. Authorization codes lever i tio minuter; bara ett byte som pågår under cutovern kan behöva göras om. Samma MCP-adress.

## 11. Rollback

1. Deploya föregående API-commit.
2. Återskapa `oauth_consume_code` från `supabase/migrations/20260911182300_oauth_public_rpcs.sql` och `grant execute ... to anon` **öppnar hålet igen**. Gör det inte utan att veta det.

Hellre: lämna SQL på plats och rulla bara API om den nya koden har en bugg, så länge API:t anropar `oauth_exchange_code`.

## 12. Kvarvarande risker (medvetet utanför)

- Authorization code i redirect-URL kan fortfarande läcka. PKCE skyddar mot den som inte har verifiern.
- `oauth_save_code` och `oauth_get_client` är oförändrade.
- Sessions-RPC `oauth_get_session` / `oauth_reuse_session` är fortfarande anropbara med anon-nyckel plus opaque MCP-token (tidigare beslut så Connect inte krävde service_role för befintliga sessioner).
- Hårdkodad anon-fallback i `env.ts` är orörd.
- Utan `SUPABASE_SERVICE_ROLE_KEY` på just den Vercel-deploy som serverar `/oauth/token` slutar nya Connect-byten. Redan anslutna sessioner påverkas inte.
