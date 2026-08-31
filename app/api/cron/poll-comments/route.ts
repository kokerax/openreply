/**
 * Yorum yoklayici cron ucu.
 *
 * Webhook'larin kacirdigi yorumlar icin guvenlik agi. Daha once worker
 * surecinin icinde 5 dakikada bir kosuyordu; worker kalkinca buraya tasindi.
 *
 * ⚠️ Tarama penceresi (`COMMENT_POLL_LOOKBACK_HOURS`) BILEREK dar tutuluyor.
 * 2026-08-30'da 72 saatlik varsayilan, "her gonderi" eslesmesiyle birlesince
 * 7 dakikada 139 kisiye 168 DM attirdi — cogu aylar once baska bir sistem
 * tarafindan zaten yanitlanmis kisilerdi. Genisletmeden once gecmisi muhurle.
 */
import { NextRequest, NextResponse } from "next/server";
import { reconcileComments } from "@/lib/polling/comment-reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function yetkili(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("key") === secret;
}

export async function GET(request: NextRequest) {
  if (!yetkili(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const basla = Date.now();
  try {
    await reconcileComments();
    return NextResponse.json({ success: true, sureMs: Date.now() - basla });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "poll failed" },
      { status: 500 }
    );
  }
}
