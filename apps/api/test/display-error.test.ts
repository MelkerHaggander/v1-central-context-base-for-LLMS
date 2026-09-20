import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayErrorMessage } from "../lib/display-error";

describe("displayErrorMessage", () => {
  it("shows English for locked Swedish API messages", () => {
    assert.equal(
      displayErrorMessage("INVALID_CREDENTIALS", "Fel mejl eller lösenord."),
      "Wrong email or password.",
    );
  });
});
