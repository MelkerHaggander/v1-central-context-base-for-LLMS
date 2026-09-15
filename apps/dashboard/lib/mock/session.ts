/**
 * Mock-session via httpOnly-cookie. Ägaren bestäms av inloggningen, aldrig av klienten.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountById, type MockAccount } from "./accounts";

export const SESSION_COOKIE = "dashboard_mock_session";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export function jsonOk(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

export function jsonOwned(body: unknown, userId: string, status = 200) {
  return jsonOk(body, status, { "X-V1-User-Id": userId });
}

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status, headers: NO_STORE });
}

export async function currentAccount(): Promise<MockAccount | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  return id ? accountById(id) : null;
}

export function setSessionCookie(response: NextResponse, accountId: string) {
  response.cookies.set(SESSION_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
