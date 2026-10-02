# `apps/api`

Next.js surface for the globe, login, OAuth and MCP. Vercel Root Directory stays `apps/api`.

The brain is `boringcontext`, at the repository root. Memory routes start `python -m boringcontext.invoke`. They do not keep a second copy of the rules.

```bash
cd apps/api
npm install
npm test
npm run dev
```

Set `SUPABASE_URL` and an anon or publishable key in the environment when the process should use a project. Do not commit keys.

From the repository root, `python -m boringcontext` is the same brain without Next. See the root README.
