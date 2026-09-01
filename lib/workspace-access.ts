import type { Workspace, WorkspaceRole } from "@/app/generated/prisma/client";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser } from "@/lib/workspace";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  workspace: Workspace;
  role: WorkspaceRole;
};

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasWorkspaceRole(
  role: WorkspaceRole,
  minimumRole: WorkspaceRole
) {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
}

export function canManageWorkspace(role: WorkspaceRole) {
  return hasWorkspaceRole(role, "ADMIN");
}

export function canManageBilling(role: WorkspaceRole) {
  return role === "OWNER";
}

/* ---------------- Member management rules (pure, unit-tested) ---------------- */

export type MemberRuleResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

export interface MemberRuleInput {
  /** The signed-in user performing the action. */
  actor: { userId: string; role: WorkspaceRole };
  /** The membership row being changed or removed. */
  target: { userId: string; role: WorkspaceRole };
  /** OWNER rows in the workspace, counting the target if it is one. */
  ownerCount: number;
}

function deny(status: 400 | 403, error: string): MemberRuleResult {
  return { ok: false, status, error };
}

/**
 * May `actor` set `target`'s role to `nextRole`?
 *
 * - Only OWNER/ADMIN change roles at all.
 * - Only an OWNER may touch an OWNER row or hand out the OWNER role; an ADMIN
 *   promoting themselves (or anyone) to OWNER would be a privilege escalation.
 * - The last OWNER can never be demoted — the workspace would be orphaned.
 */
export function evaluateRoleChange(
  input: MemberRuleInput,
  nextRole: WorkspaceRole
): MemberRuleResult {
  const { actor, target, ownerCount } = input;

  if (!canManageWorkspace(actor.role)) {
    return deny(403, "Only owners and admins can change roles");
  }
  if (
    actor.role !== "OWNER" &&
    (target.role === "OWNER" || nextRole === "OWNER")
  ) {
    return deny(403, "Only an owner can assign or change the owner role");
  }
  if (target.role === "OWNER" && nextRole !== "OWNER" && ownerCount <= 1) {
    return deny(400, "The workspace needs at least one owner");
  }
  return { ok: true };
}

/**
 * May `actor` remove `target` from the workspace?
 *
 * - Anyone may remove themselves (leave), unless they are the last OWNER.
 * - Removing someone else needs OWNER/ADMIN; only an OWNER may remove an OWNER.
 * - The last OWNER can never be removed.
 */
export function evaluateMemberRemoval(input: MemberRuleInput): MemberRuleResult {
  const { actor, target, ownerCount } = input;
  const isSelf = actor.userId === target.userId;

  if (!isSelf && !canManageWorkspace(actor.role)) {
    return deny(403, "Only owners and admins can remove members");
  }
  if (!isSelf && actor.role !== "OWNER" && target.role === "OWNER") {
    return deny(403, "Only an owner can remove another owner");
  }
  if (target.role === "OWNER" && ownerCount <= 1) {
    return deny(
      400,
      isSelf
        ? "You are the last owner — make someone else an owner before leaving"
        : "The workspace needs at least one owner"
    );
  }
  return { ok: true };
}

/**
 * A PENDING invitation whose expiry has passed is shown as EXPIRED even if the
 * row has not been flipped yet (that only happens when someone tries to accept
 * it). Every other status is reported as stored.
 */
export function effectiveInvitationStatus(
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED",
  expiresAt: Date,
  now: Date = new Date()
): "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED" {
  if (status === "PENDING" && expiresAt.getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  return status;
}

export async function getCurrentWorkspaceContext(): Promise<WorkspaceContext | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    return {
      userId,
      workspaceId: membership.workspaceId,
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const workspace = await ensureWorkspaceForUser(userId, user?.email);
  const createdMembership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId,
      },
    },
  });

  return {
    userId,
    workspaceId: workspace.id,
    workspace,
    role: createdMembership?.role ?? "OWNER",
  };
}
