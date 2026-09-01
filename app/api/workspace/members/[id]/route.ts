import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  evaluateMemberRemoval,
  evaluateRoleChange,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

/**
 * Single-member operations:
 *   PATCH  /api/workspace/members/[id]  { role }   → change role
 *   DELETE /api/workspace/members/[id]             → remove (or leave)
 *
 * Authorization lives in lib/workspace-access.ts (evaluateRoleChange /
 * evaluateMemberRemoval) so the rules are unit-tested without a database.
 */

const roleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

type RouteContext = { params: Promise<{ id: string }> };

async function loadTarget(workspaceId: string, memberId: string) {
  const [member, ownerCount] = await Promise.all([
    prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      select: { id: true, userId: true, role: true },
    }),
    prisma.workspaceMember.count({ where: { workspaceId, role: "OWNER" } }),
  ]);
  return { member, ownerCount };
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = roleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Role must be OWNER, ADMIN or MEMBER" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const { member, ownerCount } = await loadTarget(context.workspaceId, id);
  if (!member) {
    return NextResponse.json(
      { success: false, error: "Member not found" },
      { status: 404 }
    );
  }

  const verdict = evaluateRoleChange(
    {
      actor: { userId: context.userId, role: context.role },
      target: { userId: member.userId, role: member.role },
      ownerCount,
    },
    parsed.data.role
  );
  if (!verdict.ok) {
    return NextResponse.json(
      { success: false, error: verdict.error },
      { status: verdict.status }
    );
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
    select: { id: true, role: true, userId: true },
  });

  return NextResponse.json({ success: true, data: { member: updated } });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const { member, ownerCount } = await loadTarget(context.workspaceId, id);
  if (!member) {
    return NextResponse.json(
      { success: false, error: "Member not found" },
      { status: 404 }
    );
  }

  const verdict = evaluateMemberRemoval({
    actor: { userId: context.userId, role: context.role },
    target: { userId: member.userId, role: member.role },
    ownerCount,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { success: false, error: verdict.error },
      { status: verdict.status }
    );
  }

  await prisma.workspaceMember.delete({ where: { id: member.id } });

  return NextResponse.json({
    success: true,
    data: { removed: true, self: member.userId === context.userId },
  });
}
