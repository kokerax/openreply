import { NextRequest, NextResponse } from "next/server";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { shareUpdateSchema, updateReportShare } from "./share-logic";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** PATCH { enabled: boolean } → creates the share slug if missing and toggles. */
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can share reports" },
      { status: 403 }
    );
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const parsed = shareUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = await updateReportShare(context.workspaceId, id, parsed.data.enabled);
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, data });
}
