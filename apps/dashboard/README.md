# `apps/dashboard/` — Boringcontext dashboard (V2)

**Owner:** Filip
**Branch:** `filip/dashboard-v2`, branched from `integration/v1.1`
**Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, deployed on Vercel (region `arn1`, Stockholm)
**Contract:** [docs/contracts.md](../../docs/contracts.md) and [docs/filip-auth.md](../../docs/filip-auth.md). No memory format of its own.
**Language:** English. Required by *Mål för V1.1* section 2.

## What V2 adds over V1

| | V1 | V2 |
| --- | --- | --- |
| Main view | a list of 50 rows | a globe of every memory, list beside it |
| Create | not possible | `POST /api/memories` |
| Edit | not possible | `PATCH /api/memories/:id` |
| Delete | not possible | `DELETE /api/memories/:id`, two-step confirm |
| Categories | five, Swedish labels | six including Lesson, English labels |
| Created date | not shown | shown per memory, plus updated |
| Totals | none | counted across all pages, with a truncation warning |
| Theme | followed the OS | follows the OS, with a toggle |
| Name | "Claude-minne" | Boringcontext |

## The globe

`/dashboard` is the globe. One dot is one memory. **Position is the project**,
**colour is the category**. Clicking goes down one level at a time: the whole
sphere to a project, a project to a single memory. Drag to turn it. Escape goes
back out.

It is real 3D. Unit vectors on a sphere, a rotation matrix, a perspective divide
and a back-to-front depth sort, drawn on a 2D canvas.

**There is no 3D library and no new dependency, on purpose.** `package-lock.json`
is unchanged by this branch. `apps/api` builds from the same lockfile on Vercel,
so a WebGL dependency here would land in the deployment that serves `/api/mcp`
as well, to draw a few hundred dots that canvas handles at 60fps. If the globe
ever needs real WebGL, `components/globe/GlobeCanvas.tsx` is the only file that
has to change: the maths in `lib/globe/` is renderer-agnostic and unit tested.

| File | Job |
| --- | --- |
| `lib/globe/sphere.ts` | Where a dot goes. Project zones, deterministic placement from the memory id. |
| `lib/globe/camera.ts` | Rotation, perspective, fly-to, hit testing. |
| `components/globe/GlobeCanvas.tsx` | The loop, the input, the paint. |
| `components/GlobeView.tsx` | Breadcrumb, legend, panels, editor. |

A dot's position comes from a hash of its id, so it keeps the same spot across
refreshes. A dot that jumped every fifteen seconds would make the globe useless.
A project's zone comes from its **name**, never its size, so a project does not
move across the sphere because it gained a memory.

## Colour is not decoration

The six category hues are validated, not chosen by eye. Every neighbouring pair
in the category order clears colour-vision separation (worst adjacent CVD deltaE
16.3 light, 13.2 dark, target >= 8) and the normal-vision floor (19.6 and 19.3,
floor 15) against both surfaces. The values and the order live in
`lib/categories.ts`; re-validate before changing either.

Two consequences that are easy to undo by accident:

- On the light surface Goal and Deadline sit below 3:1 contrast, so **colour is
  never the only channel**. Every dot, chip and legend row carries its label as
  text, and the panel is the full text equivalent of the globe.
- The interface chrome has **no hue at all**. The accent is the ink itself, so no
  button, border or focus ring can be mistaken for a category.

## Accessibility

A canvas cannot be tabbed into, so it is never the only route to anything. Every
project and every category is a real button next to it, the panel lists every
field of every memory as text, and the sphere stops spinning when the reader
prefers reduced motion.

## Totals are honest about their ceiling

The contract has no count and no aggregate endpoint: `GET /api/memories` returns
at most 50 rows with an offset. So the totals are counted in the browser by
walking pages (`fetchAllMemories`), with a ceiling of `MAX_PAGES` (20 pages,
1000 rows).

When the ceiling is reached the view says so in plain text instead of printing a
total it cannot stand behind. **The clean fix is a count on the API**, which is
Alfredo's call because the contract is locked.

## Not built, and why

*Mål för V1.1* section 2 asks the dashboard to show **which LLM or conversation a
memory came from**. It cannot be done from here. `public.memories` has
`id, user_id, project, category, title, content, created_at, updated_at` and
nothing about the client that wrote the row
(`supabase/migrations/20260911162129_create_memories.sql`). Nothing in a row
identifies Claude from ChatGPT from Grok.

It needs a column plus the MCP server setting it, which is `apps/api` and a
migration against the shared database, so by the stop rule in *Egna
V1-experiment med gemensam Supabase* it is a team decision, not a branch change.
Until then the detail panel says **Source: not recorded** rather than guessing.

## A bug this branch fixes

`lib/upstream.ts` did not forward `x-v1-user-id`. Alfredo's API sets it
(docs/filip-auth.md) and `lib/tab-session.ts` compares it against the account the
tab is bound to, so in upstream mode the header never reached the browser,
`memoryBelongsToTab()` saw `null`, and the tab-isolation guard from
`cursor/session-isolate-d243` passed everything through. Mock mode was fine
because `jsonOwned()` sets the header locally, which is why it went unnoticed:
the guard was only off in the mode that has real accounts in it.

## Run it locally

```bash
cd apps/dashboard
npm install --include=dev   # --include=dev is needed when NODE_ENV=production is set globally
npm run dev                 # http://localhost:3000
npm test                    # contract, globe maths, aggregation, instruction text
npm run build               # the same build Vercel runs
```

With no environment variables it starts in **standalone mock mode**. Sign in with
`filip@example.com`, `alfredo@example.com` or `melker@example.com` and the
password `mock-losen` (override with `MOCK_PASSWORD`). Each mock account is seeded
with 22 memories across 5 projects and all six categories, so the globe has
something to be a globe about. The mock store lives in the server process and
resets on restart. That is deliberate.

## Two modes, one codebase

| Mode | `API_BASE_URL` | What happens to `/api/*` |
| --- | --- | --- |
| Standalone (mock) | empty | The route files under `app/api/` answer from the mock store. |
| Live | `https://v1-central-context-base-for-llms.vercel.app` | The same route files forward to Alfredo's API via `lib/upstream.ts`. |

The views only call `lib/api.ts`. Switching mock to live is one environment
variable, not a code change.

## Deploying this branch

A separate Vercel project, per *Egna V1-experiment med gemensam Supabase*:

1. Same team, same GitHub repo.
2. **Root Directory `apps/dashboard`**. This is the step that is easy to miss:
   the existing project `v1-central-context-base-for-llms` has Root Directory
   `apps/api` and does not build this app at all.
3. Production Branch: this branch.
4. Environment variables: `API_BASE_URL`, and `VERCEL_PROTECTION_BYPASS` only if
   the upstream deployment has Deployment Protection on.

**This app needs no Supabase keys.** It never talks to Supabase; it forwards to
`apps/api`, which holds them. In particular `SUPABASE_SERVICE_ROLE_KEY` does not
belong in this project: it bypasses row level security and the dashboard has no
use for it.

## Tests

`npm test` runs, in `test/`:

- `mock-store.test.ts` — the mock store against contracts.md, including `lesson`.
- `instructions.test.ts`, `mcp-instructions.test.ts` — the instruction text is
  byte-identical to `docs/`. Do not translate those strings: they are
  instructions to the model, not interface copy, and these tests fail on drift.
- `deny-url.test.ts` — the OAuth deny link.
- `globe-sphere.test.ts` — determinism, containment, non-overlapping zones,
  stable placement when counts change.
- `globe-camera.test.ts` — rotation, projection, clamping, and that a dot on the
  far side of the globe can never be clicked.
- `aggregate.test.ts` — counting, truncation flag, and field validation in the
  server's order.

## For Alfredo: the OAuth view

Still `components/OAuthApproveView.tsx`, still a server component with no hooks,
still the same field names and the same action. It is English now and says
Boringcontext. The `OAUTH_ERROR_TEXT` keys are unchanged; only the text is
translated. Copy the `:root` block from `app/globals.css` along with it or the
view renders unstyled.
