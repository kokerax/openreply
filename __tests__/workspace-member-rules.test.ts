/**
 * Workspace member rules — unit tests
 *
 * evaluateRoleChange / evaluateMemberRemoval back the
 * /api/workspace/members/[id] route; effectiveInvitationStatus backs the
 * invitation list in GET /api/workspace/members.
 */

import { describe, expect, it, vi } from "vitest";

// workspace-access imports auth (NextAuth) and prisma at module level; none of
// the functions under test touch them.
vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: vi.fn() }));

import {
  effectiveInvitationStatus,
  evaluateMemberRemoval,
  evaluateRoleChange,
  type MemberRuleInput,
} from "../lib/workspace-access";

const owner = { userId: "u_owner", role: "OWNER" as const };
const admin = { userId: "u_admin", role: "ADMIN" as const };
const member = { userId: "u_member", role: "MEMBER" as const };
const otherOwner = { userId: "u_owner2", role: "OWNER" as const };

function input(
  actor: MemberRuleInput["actor"],
  target: MemberRuleInput["target"],
  ownerCount: number
): MemberRuleInput {
  return { actor, target, ownerCount };
}

describe("evaluateRoleChange", () => {
  it("lets an owner promote a member to admin", () => {
    expect(evaluateRoleChange(input(owner, member, 1), "ADMIN")).toEqual({
      ok: true,
    });
  });

  it("lets an admin change a member's role", () => {
    expect(evaluateRoleChange(input(admin, member, 1), "ADMIN")).toEqual({
      ok: true,
    });
  });

  it("refuses a plain member", () => {
    const result = evaluateRoleChange(input(member, admin, 1), "MEMBER");
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses an admin granting OWNER (privilege escalation)", () => {
    expect(evaluateRoleChange(input(admin, admin, 1), "OWNER")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(evaluateRoleChange(input(admin, member, 1), "OWNER")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses an admin touching an owner's role", () => {
    expect(evaluateRoleChange(input(admin, otherOwner, 2), "MEMBER")).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses demoting the last owner, even by themselves", () => {
    expect(evaluateRoleChange(input(owner, owner, 1), "ADMIN")).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("at least one owner"),
    });
  });

  it("lets an owner demote another owner when two remain", () => {
    expect(evaluateRoleChange(input(owner, otherOwner, 2), "ADMIN")).toEqual({
      ok: true,
    });
  });

  it("treats OWNER → OWNER as a harmless no-op even for the last owner", () => {
    expect(evaluateRoleChange(input(owner, owner, 1), "OWNER")).toEqual({
      ok: true,
    });
  });
});

describe("evaluateMemberRemoval", () => {
  it("lets an owner remove a member", () => {
    expect(evaluateMemberRemoval(input(owner, member, 1))).toEqual({ ok: true });
  });

  it("lets an admin remove a member", () => {
    expect(evaluateMemberRemoval(input(admin, member, 1))).toEqual({ ok: true });
  });

  it("refuses a member removing someone else", () => {
    expect(evaluateMemberRemoval(input(member, admin, 1))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("lets a member remove themselves (leave)", () => {
    expect(evaluateMemberRemoval(input(member, member, 1))).toEqual({ ok: true });
  });

  it("refuses an admin removing an owner", () => {
    expect(evaluateMemberRemoval(input(admin, otherOwner, 2))).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("refuses removing the last owner", () => {
    expect(evaluateMemberRemoval(input(owner, owner, 1))).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("last owner"),
    });
  });

  it("lets an owner leave when another owner remains", () => {
    expect(evaluateMemberRemoval(input(owner, owner, 2))).toEqual({ ok: true });
  });

  it("lets an owner remove another owner when two remain", () => {
    expect(evaluateMemberRemoval(input(owner, otherOwner, 2))).toEqual({
      ok: true,
    });
  });
});

describe("effectiveInvitationStatus", () => {
  const now = new Date("2026-09-02T12:00:00Z");

  it("reports a pending invitation past its expiry as EXPIRED", () => {
    expect(
      effectiveInvitationStatus("PENDING", new Date("2026-09-01T00:00:00Z"), now)
    ).toBe("EXPIRED");
  });

  it("keeps a pending invitation that has not expired", () => {
    expect(
      effectiveInvitationStatus("PENDING", new Date("2026-09-09T00:00:00Z"), now)
    ).toBe("PENDING");
  });

  it("never rewrites a terminal status, expired or not", () => {
    const past = new Date("2026-01-01T00:00:00Z");
    expect(effectiveInvitationStatus("ACCEPTED", past, now)).toBe("ACCEPTED");
    expect(effectiveInvitationStatus("REVOKED", past, now)).toBe("REVOKED");
    expect(effectiveInvitationStatus("EXPIRED", past, now)).toBe("EXPIRED");
  });
});
