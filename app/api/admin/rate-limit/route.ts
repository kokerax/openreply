import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import {
  BURST_MAX,
  BURST_WINDOW_SEC,
  HOURLY_MAX,
  HOURLY_WINDOW_SEC,
  hizDurumu,
} from "@/lib/ops/rate-status";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const requested = request.nextUrl.searchParams.get("instagramAccountId");
  const instagramAccountId = requested && requested !== "all" ? requested : undefined;

  try {
    const accounts = await hizDurumu(instagramAccountId, workspaceId);
    return NextResponse.json({
      success: true,
      data: {
        checkedAt: new Date().toISOString(),
        limits: {
          burst: { max: BURST_MAX, windowSec: BURST_WINDOW_SEC },
          hourly: { max: HOURLY_MAX, windowSec: HOURLY_WINDOW_SEC },
        },
        accounts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rate limit status failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
