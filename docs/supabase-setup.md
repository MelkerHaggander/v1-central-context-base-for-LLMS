# Supabase V1 — Stockholm

Projektet **finns redan** och migrationerna är applicerade. Lösenord och `service_role` hör inte hemma i git.

| | |
| --- | --- |
| Namn | `v1-central-context-base` |
| Ref | `uthkzkvpkkpzrmzjunqq` |
| Region | Stockholm (`eu-north-1`) |
| Plan | Free |
| Dashboard | https://supabase.com/dashboard/project/uthkzkvpkkpzrmzjunqq |
| API-URL | `https://uthkzkvpkkpzrmzjunqq.supabase.co` |

Tabell `public.memories`: `id`, `user_id`, `project`, `category`, `title`, `content`, `created_at`, `updated_at`. RLS: SELECT/INSERT/UPDATE/DELETE bara när `user_id = auth.uid()`. Anon har inga grants. Identiska dubbletter stoppas per konto. Radering går bara via dashboard-HTTP, inte MCP.

## Alfredo gör nu (dashboard)

### 1. Stäng av publik signup

1. Öppna [Authentication → Providers → Email](https://supabase.com/dashboard/project/uthkzkvpkkpzrmzjunqq/auth/providers)
2. Stäng av **Allow new users to sign up**
3. Spara

### 2. Tre förskapade konton

1. [Authentication → Users](https://supabase.com/dashboard/project/uthkzkvpkkpzrmzjunqq/auth/users) → **Add user**
2. Skapa tre användare med e-post + lösenord (Auto Confirm User på)
3. Lösenord i delad lösenordshanterare, **inte** i git eller PR

### 3. Klistra in i Vercel (Preview + Production)

Projekt: `v1-central-context-base-for-llms`. Settings → Environment Variables.

| Namn | Värde | Environment |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://uthkzkvpkkpzrmzjunqq.supabase.co` | Preview, Production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` `public` | Preview, Production |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` **secret** | Preview, Production. **Aldrig** `NEXT_PUBLIC_` |

Efter att variablerna är satta: sätt **Root Directory** till `apps/api` och Redeploy av `alfredo/integrations`-preview.

Skicka till teamet: **ref + preview-URL**. Inte nycklar.
