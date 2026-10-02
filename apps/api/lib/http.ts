import { NextResponse } from "next/server";

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export function jsonOk(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

/** The cookie's user. The client hides the rows when this id does not match. */
export function jsonOwned(body: unknown, userId: string, status = 200) {
  return jsonOk(body, status, { "X-V1-User-Id": userId });
}

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE },
  );
}
