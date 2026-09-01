import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canSendDMForWorkspace } from "@/lib/billing/usage";
import {
  buildInvitationUrl,
  generateInvitationToken,
  getInvitationExpiry,
  normalizeInvitationEmail,
} from "@/lib/workspace-invitations";
import {
  canManageWorkspace,
  effectiveInvitationStatus,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * Workspace team listing + invitations.
 *   GET    → members, invitations (all statuses), usage
 *   POST   → invite by email
 *   DELETE → revoke an invitation
 *
 * Per-member role change / removal live in ./[id]/route.ts.
 */

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

const deleteSchema = z.object({
  invitationId: z.string().min(1),
});

// Non-pending invitations are history; keep the list bounded.
const INVITATION_LIMIT = 50;

async function getMemberPayload(
  workspaceId: string,
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER",
  currentUserId: string
) {
  const [members, invitations, usage, workspace] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
    prisma.workspaceInvitation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: INVITATION_LIMIT,
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
    }),
    // Real counter from the usage module (also rolls the period over if the
    // month changed), not a hardcoded "no limits" line.
    canSendDMForWorkspace(workspaceId),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { usagePeriodStart: true, dmsSentThisPeriod: true },
    }),
  ]);

  const now = new Date();
  return {
    currentUserRole,
    currentUserId,
    members,
    invitations: invitations.map(({ token, ...invitation }) => {
      const status = effectiveInvitationStatus(
        invitation.status,
        invitation.expiresAt,
        now
      );
      return {
        ...invitation,
        status,
        // The link only means something while it can still be accepted.
        inviteUrl: status === "PENDING" ? buildInvitationUrl(token) : null,
      };
    }),
    usage: {
      dmsSentThisPeriod: workspace?.dmsSentThisPeriod ?? 0,
      periodStart: workspace?.usagePeriodStart ?? null,
      limit: usage.limit,
      remaining: usage.remaining,
    },
  };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(
      context.workspaceId,
      context.role,
      context.userId
    ),
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can invite members" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid invitation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = normalizeInvitationEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: existingUser.id,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        userId: existingUser.id,
        role: parsed.data.role,
      },
      update: {
        role: parsed.data.role,
      },
    });
  } else {
    await prisma.workspaceInvitation.upsert({
      where: {
        workspaceId_email: {
          workspaceId: context.workspaceId,
          email,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        email,
        role: parsed.data.role,
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
      },
      update: {
        role: parsed.data.role,
        status: "PENDING",
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
        acceptedAt: null,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(
      context.workspaceId,
      context.role,
      context.userId
    ),
  });
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can revoke invitations" },
      { status: 403 }
    );
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Missing invitation ID" },
      { status: 400 }
    );
  }

  const result = await prisma.workspaceInvitation.updateMany({
    where: {
      id: parsed.data.invitationId,
      workspaceId: context.workspaceId,
      status: "PENDING",
    },
    data: { status: "REVOKED" },
  });
  if (result.count === 0) {
    return NextResponse.json(
      { success: false, error: "Invitation is not pending" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(
      context.workspaceId,
      context.role,
      context.userId
    ),
  });
}
