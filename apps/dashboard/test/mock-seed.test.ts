import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOCK_ACCOUNTS } from "../lib/mock/accounts";
import { mockDb, PERSONAL_SPACE, SHARED_SPACE } from "../lib/mock/db";
import { validateMemoryId } from "../lib/mock/store";

/**
 * Every seeded row must be deletable. The personal seed ids once had nine
 * characters in their first group, so the mock answered 400 INVALID_ID to
 * every delete of a personal seed row and nobody noticed until undo-delete
 * put them back.
 */
describe("mock seed", () => {
  it("every row id is a UUID the API accepts", () => {
    for (const account of MOCK_ACCOUNTS) {
      for (const space of [PERSONAL_SPACE[account.id], SHARED_SPACE]) {
        const rows = mockDb.searchInSpace(account.id, space, {});
        assert.ok("data" in rows);
        assert.ok(rows.data.length > 0);
        for (const row of rows.data) assert.ok("data" in validateMemoryId(row.id), `bad id ${row.id}`);
      }
    }
  });
});
