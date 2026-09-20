import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayApiError, displayErrorMessage } from "../lib/display-error";

describe("displayErrorMessage", () => {
  it("shows English for locked Swedish API messages", () => {
    assert.equal(
      displayErrorMessage("INVALID_CREDENTIALS", "Fel mejl eller lösenord."),
      "Wrong email or password.",
    );
    assert.equal(
      displayErrorMessage("NOT_FOUND", "Minnet finns inte eller tillhör ett annat konto."),
      "The memory does not exist or belongs to another account.",
    );
    assert.equal(
      displayErrorMessage(
        "INVALID_CATEGORY",
        "category måste vara fact, decision, goal, deadline, preference eller lesson.",
      ),
      "Category must be fact, decision, goal, deadline, preference or lesson.",
    );
    assert.equal(displayApiError({ code: "UNAUTHENTICATED", message: "Inte inloggad." }), "You are not signed in.");
  });

  it("keeps unknown English messages as-is", () => {
    assert.equal(displayErrorMessage("WEIRD", "Something custom."), "Something custom.");
    assert.equal(displayErrorMessage("HTTP_502", "ignored"), "The server answered 502.");
  });

  it("never shows leftover Swedish text", () => {
    assert.equal(
      displayErrorMessage(undefined, "Kunde inte nå servern. Kontrollera anslutningen."),
      "Something went wrong.",
    );
    assert.equal(displayErrorMessage("WEIRD", "Inte inloggad."), "Something went wrong (WEIRD).");
  });
});
