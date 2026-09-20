/**
 * English text for error codes the API still returns in Swedish.
 * Codes and HTTP behaviour stay locked; only what the dashboard shows changes.
 */
const BY_CODE: Record<string, string> = {
  INVALID_CREDENTIALS: "Wrong email or password.",
  UNAUTHENTICATED: "You are not signed in.",
  INVALID_BODY: "The request was not valid JSON.",
  INVALID_PROJECT: "Project must be 1–100 characters.",
  INVALID_TITLE: "Title must be 1–150 characters.",
  INVALID_CONTENT: "Content must be 1–10,000 characters.",
  INVALID_CATEGORY: "Category must be fact, decision, goal, deadline, preference or lesson.",
  INVALID_ID: "id must be a UUID.",
  INVALID_OFFSET: "offset must be an integer 0 or higher.",
  NOT_FOUND: "The memory does not exist or belongs to another account.",
  ACCOUNT_SWITCHED: "Another account is signed in in this browser. Memories are not mixed.",
  NETWORK_ERROR: "Could not reach the server. Check the connection.",
  UPSTREAM_UNREACHABLE: "Could not reach the API.",
  SAVE_FAILED: "Could not save the memory.",
  UPDATE_FAILED: "Could not update the memory.",
  DELETE_FAILED: "Could not delete the memory.",
  SEARCH_FAILED: "Could not search memories.",
  INVALID_RESPONSE: "The server answered without valid JSON.",
  DELETE_UNCONFIRMED: "The server did not confirm the delete. Refresh before trying again.",
};

export function displayErrorMessage(code: string | undefined, message: string): string {
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (code?.startsWith("HTTP_")) {
    const status = code.slice("HTTP_".length);
    return `The server answered ${status}.`;
  }
  return message;
}
