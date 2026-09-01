import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  BITMEMIS_DURUMLAR,
  TAKILMA_ESIGI_DK,
  basarisizlariYenidenKuyrukla,
  eskiTamamlananlariSil,
  isleriListele,
  takilanIsSayisi,
  type YonetimIsDurumu,
} from "@/lib/queue/pg-queue";

export const runtime = "nodejs";

const DURUMLAR: YonetimIsDurumu[] = ["PENDING", "ACTIVE", "DONE", "FAILED"];

/**
 * Kuyruk isleri calisma alanina `data.instagramAccountId` uzerinden baglanir
 * (dort is tipi de bu alani tasir). Hesapsiz bir is hicbir alana gosterilmez.
 */
async function hesapIdleriniGetir(workspaceId: string): Promise<string[]> {
  const hesaplar = await prisma.instagramAccount.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  return hesaplar.map((h) => h.id);
}

function durumlariCoz(param: string | null): YonetimIsDurumu[] {
  if (!param || param === "OPEN") return BITMEMIS_DURUMLAR;
  if (param === "ALL") return DURUMLAR;
  const secilen = param
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter((d): d is YonetimIsDurumu => (DURUMLAR as string[]).includes(d));
  return secilen.length ? secilen : BITMEMIS_DURUMLAR;
}

// GET /api/admin/queue?status=OPEN|ALL|PENDING,ACTIVE,...
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const hesapIdleri = await hesapIdleriniGetir(ctx.workspaceId);
    const durumlar = durumlariCoz(request.nextUrl.searchParams.get("status"));
    const simdi = new Date();
    const [jobs, stuckCount] = await Promise.all([
      isleriListele({ hesapIdleri, durumlar, limit: 200 }),
      takilanIsSayisi(hesapIdleri, simdi),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        jobs,
        stuckCount,
        stuckThresholdMinutes: TAKILMA_ESIGI_DK,
        scopedToAccounts: hesapIdleri.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue could not be loaded.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RETRY_FAILED") }),
  z.object({
    action: z.literal("PURGE_DONE"),
    olderThanDays: z.number().int().min(1).max(365).default(7),
  }),
]);

// POST /api/admin/queue  { action: "RETRY_FAILED" } | { action: "PURGE_DONE", olderThanDays }
export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageWorkspace(ctx.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  try {
    const hesapIdleri = await hesapIdleriniGetir(ctx.workspaceId);
    const simdi = new Date();
    if (parsed.data.action === "RETRY_FAILED") {
      const count = await basarisizlariYenidenKuyrukla(hesapIdleri, simdi);
      return NextResponse.json({ success: true, data: { action: "RETRY_FAILED", count } });
    }
    const count = await eskiTamamlananlariSil(hesapIdleri, parsed.data.olderThanDays, simdi);
    return NextResponse.json({
      success: true,
      data: { action: "PURGE_DONE", olderThanDays: parsed.data.olderThanDays, count },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk action failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
