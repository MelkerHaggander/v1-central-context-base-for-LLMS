/**
 * Måndagsläget. När API_BASE_URL är satt skickas varje /api-anrop vidare till Alfredos API
 * på servern, i stället för att mock-routen svarar. Webbläsaren ser bara dashboardens origin.
 *
 * Varför inte CORS direkt mot Alfredo: hans API sätter inga CORS-headers, och Supabase-cookies
 * skulle bli tredjepartscookies. Via proxyn sätts Set-Cookie från Supabase på dashboardens domän
 * och skickas tillbaka i nästa anrop, exakt som om dashboarden låg i samma app.
 *
 * VERCEL_PROTECTION_BYPASS: om Alfredos preview har Vercel Deployment Protection påslaget
 * blockeras server-till-server-anrop med en HTML-inloggning. Sätt "Protection Bypass for
 * Automation"-hemligheten från hans Vercel-projekt här så släpps proxyn igenom.
 */

function baseUrl(): string {
  return (process.env.API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function upstreamEnabled(): boolean {
  return baseUrl() !== "";
}

const FORWARD_REQUEST_HEADERS = ["cookie", "content-type", "accept", "accept-language"];

/**
 * x-v1-user-id must be forwarded. Alfredos API sets it (docs/filip-auth.md) and
 * lib/tab-session.ts compares it against the account this tab is bound to. It
 * was missing from this list, so in upstream mode the header never reached the
 * browser, memoryBelongsToTab() saw null, and the tab-isolation guard added in
 * cursor/session-isolate-d243 passed everything through. Mock mode was fine
 * because jsonOwned() sets it locally, which is why it went unnoticed: the guard
 * was only off in the mode that has real accounts in it.
 */
const FORWARD_RESPONSE_HEADERS = ["content-type", "x-v1-user-id"];

/**
 * Returnerar null i mock-läge (anroparen svarar själv). Annars svaret från Alfredos API,
 * med status, body och alla Set-Cookie oförändrade.
 */
export async function proxyToUpstream(request: Request, path: string): Promise<Response | null> {
  const base = baseUrl();
  if (!base) return null;

  const incoming = new URL(request.url);
  const target = `${base}${path}${incoming.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const bypass = process.env.VERCEL_PROTECTION_BYPASS?.trim();
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return json(
      { error: { code: "UPSTREAM_UNREACHABLE", message: `Could not reach the API: ${message}` } },
      502,
    );
  }

  const out = new Headers({ "Cache-Control": "private, no-store, no-cache, must-revalidate" });
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    out.append("set-cookie", cookie);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // T.ex. Vercels inloggningssida (HTML) vid Deployment Protection, eller en 404 från main.
    return json(
      {
        error: {
          code: "UPSTREAM_NOT_JSON",
          message: `API:t svarade ${upstream.status} utan JSON. Kontrollera API_BASE_URL och Vercel Deployment Protection.`,
        },
      },
      502,
      out,
    );
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function json(body: unknown, status: number, headers?: Headers) {
  const h = headers ?? new Headers({ "Cache-Control": "private, no-store, no-cache, must-revalidate" });
  h.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}
