/** One place for the HTTP status of each error code the mock returns. */
const STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NO_ACCOUNT: 404,
  NOT_A_MEMBER: 404,
  ALREADY_MEMBER: 409,
  LAST_MEMBER: 409,
  DUPLICATE_TITLE: 409,
  PERSONAL_SPACE: 400,
};

export function statusFor(code: string): number {
  return STATUS[code] ?? (code.startsWith("INVALID_") ? 400 : 500);
}
