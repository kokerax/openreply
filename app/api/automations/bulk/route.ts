import { NextRequest, NextResponse } from "next/server";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import { bulkActionSchema, runBulkAction } from "./bulk";

export const dynamic = "force-dynamic";

/** POST { ids: string[], action: "pause" | "resume" | "delete" } */
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
      { success: false, error: "Only owners and admins can change campaigns" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const parsed = bulkActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await runBulkAction(
    context.workspaceId,
    parsed.data.ids,
    parsed.data.action
  );
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error, missing: result.missing },
      { status: result.status }
    );
  }
  return NextResponse.json({
    success: true,
    data: { action: result.action, count: result.count },
  });
}
