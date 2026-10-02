import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  listMemberSpaces,
  listSpaceMembers,
  loadMemberSpaces,
  parseTeamName,
  type MemberSpace,
} from "../lib/spaces-http";

const ALFREDO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILIP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSONAL = "11111111-1111-4111-8111-111111111111";
const SHARED = "22222222-2222-4222-8222-222222222222";
const FILIP_PERSONAL = "33333333-3333-4333-8333-333333333333";

const routeSrc = readFileSync(join(__dirname, "../app/api/spaces/route.ts"), "utf8");
const renameRouteSrc = readFileSync(join(__dirname, "../app/api/spaces/[id]/route.ts"), "utf8");
const membersRouteSrc = readFileSync(join(__dirname, "../app/api/spaces/[id]/members/route.ts"), "utf8");
const seedSrc = readFileSync(
  join(__dirname, "../../../supabase/manual/20261005_space_members.sql"),
  "utf8",
);

function rows(...items: MemberSpace[]): MemberSpace[] {
  return items;
}

describe("personal and shared spaces", () => {
  it("returns the signed-in user's personal space before the shared space", () => {
    const result = listMemberSpaces(
      rows(
        { id: SHARED, kind: "shared" },
        { id: PERSONAL, kind: "personal" },
      ),
    );
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      spaces: [
        { id: PERSONAL, kind: "personal", name: null },
        { id: SHARED, kind: "shared", name: null },
      ],
    });
  });

  it("drops another account's personal space when it is not in the member rows", () => {
    const result = listMemberSpaces(rows({ id: PERSONAL, kind: "personal" }, { id: SHARED, kind: "shared" }));
    const body = result.body as { spaces: MemberSpace[] };
    assert.equal(
      body.spaces.some((space) => space.id === FILIP_PERSONAL),
      false,
    );
  });

  it("returns an empty list when the user has no spaces", () => {
    const result = listMemberSpaces([]);
    assert.deepEqual(result.body, { spaces: [] });
  });

  it("ignores a repeated space and an unknown kind", () => {
    const result = listMemberSpaces([
      { id: PERSONAL, kind: "personal" },
      { id: PERSONAL, kind: "personal" },
      { id: "99999999-9999-4999-8999-999999999999", kind: "team" as "personal" },
    ]);
    assert.deepEqual(result.body, { spaces: [{ id: PERSONAL, kind: "personal", name: null }] });
  });

  it("loads only spaces linked to the signed-in user", async () => {
    const memberships: Record<string, string[]> = {
      [ALFREDO]: [PERSONAL, SHARED],
      [FILIP]: [FILIP_PERSONAL, SHARED],
    };
    const kinds: Record<string, string> = {
      [PERSONAL]: "personal",
      [SHARED]: "shared",
      [FILIP_PERSONAL]: "personal",
    };
    const client = {
      from(table: string) {
        return {
          select() {
            return {
              eq(_column: string, userId: string) {
                return Promise.resolve({
                  data: (memberships[userId] ?? []).map((space_id) => ({ space_id })),
                  error: null,
                });
              },
              in(_column: string, ids: string[]) {
                assert.equal(table, "spaces");
                return Promise.resolve({
                  data: ids.map((id) => ({ id, kind: kinds[id], name: null })),
                  error: null,
                });
              },
            };
          },
        };
      },
    };

    const alfredo = await loadMemberSpaces(client, ALFREDO);
    assert.deepEqual(alfredo.map((space) => space.id).sort(), [PERSONAL, SHARED].sort());
    const filip = await loadMemberSpaces(client, FILIP);
    assert.equal(
      filip.some((space) => space.id === PERSONAL),
      false,
    );
    assert.equal(
      filip.some((space) => space.id === FILIP_PERSONAL),
      true,
    );
  });

  it("accepts a trimmed team name of 1–60 characters", () => {
    assert.deepEqual(parseTeamName("  Sales  "), { ok: true, name: "Sales" });
    assert.equal(parseTeamName("").ok, false);
    assert.equal(parseTeamName("x".repeat(61)).ok, false);
  });

  it("lists members by email and drops a repeated id", () => {
    assert.deepEqual(
      listSpaceMembers([
        { user_id: FILIP, email: "filip.test@example.com" },
        { user_id: ALFREDO, email: "alfredo.test@example.com" },
        { user_id: ALFREDO, email: "alfredo.test@example.com" },
      ]),
      {
        members: [
          { user_id: ALFREDO, email: "alfredo.test@example.com" },
          { user_id: FILIP, email: "filip.test@example.com" },
        ],
      },
    );
  });

  it("answers GET and POST members for a signed-in member", () => {
    assert.match(membersRouteSrc, /export async function GET/);
    assert.match(membersRouteSrc, /export async function POST/);
    assert.equal(membersRouteSrc.includes("export async function DELETE"), false);
    assert.equal(membersRouteSrc.includes("export async function PATCH"), false);
    assert.match(membersRouteSrc, /Inte inloggad/);
    assert.match(membersRouteSrc, /getUser\(/);
    assert.match(membersRouteSrc, /isMember\(/);
    assert.match(membersRouteSrc, /FORBIDDEN/);
    assert.match(membersRouteSrc, /createSupabaseAdminClient/);
    assert.match(membersRouteSrc, /NO_ACCOUNT/);
    assert.match(membersRouteSrc, /ALREADY_MEMBER/);
    assert.equal(membersRouteSrc.includes("searchParams"), false);
  });

  it("answers DELETE member on the nested userId route", () => {
    const deleteRouteSrc = readFileSync(
      join(__dirname, "../app/api/spaces/[id]/members/[userId]/route.ts"),
      "utf8",
    );
    assert.match(deleteRouteSrc, /export async function DELETE/);
    assert.match(deleteRouteSrc, /LAST_MEMBER/);
    assert.match(deleteRouteSrc, /isMember\(/);
    assert.match(deleteRouteSrc, /createSupabaseAdminClient/);
  });

  it("requires a signed-in user and does not accept a user id from the client", () => {
    assert.match(routeSrc, /Inte inloggad/);
    assert.match(routeSrc, /getUser\(/);
    assert.match(routeSrc, /export async function POST/);
    assert.match(routeSrc, /createSupabaseAdminClient/);
    assert.equal(routeSrc.includes("searchParams"), false);
    assert.match(renameRouteSrc, /export async function PATCH/);
    assert.match(renameRouteSrc, /isMember\(/);
    assert.match(renameRouteSrc, /PERSONAL_SPACE/);
    assert.match(renameRouteSrc, /createSupabaseAdminClient/);
    assert.equal(renameRouteSrc.includes("searchParams"), false);
  });

  it("writes the three memberships without deleting memories", () => {
    assert.match(seedSrc, /alfredo\.test@example\.com/);
    assert.match(seedSrc, /filip\.test@example\.com/);
    assert.match(seedSrc, /melker\.test@example\.com/);
    assert.match(seedSrc, /personal/);
    assert.match(seedSrc, /shared/);
    assert.equal(seedSrc.toLowerCase().includes("delete from public.memories"), false);
  });
});
