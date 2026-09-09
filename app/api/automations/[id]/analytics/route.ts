import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { SADECE_YORUM } from "@/lib/queue/dmlog-kayit-turu";
import { dayKeys, resolveDateRange } from "@/lib/utils/date-range";
import { buildCampaignAnalytics } from "./compute";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: last 30 days). */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await params;
  const automation = await prisma.automation.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  });
  if (!automation) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const range = resolveDateRange(request.nextUrl.searchParams, 30);
  const createdAt = { gte: range.from, lt: range.toExclusive };
  // Migration seal rows (isBackfill) were never sent by this system and must
  // not count as comments, sends, or failures.
  const dmScope = { workspaceId, automationId: id, isBackfill: false, createdAt };
  // Huni "yorum -> DM -> tiklama" anlatiyor; her adimi AYNI evrenden saymali.
  // `sentSources` sentetikleri eliyordu ama `comments` ve `sentAt` elemiyordu:
  // e-posta kapili bir kampanyada kisi basina 2-3 defter satiri var, yani
  // payda sisip CTR 2-3 kat dusuk gorunuyordu.
  const yorumKapsami = { ...dmScope, ...SADECE_YORUM };

  const [comments, sentRows, clickRows, failedRows] = await Promise.all([
    prisma.dmLog.count({ where: yorumKapsami }),
    prisma.dmLog.findMany({
      where: { ...yorumKapsami, status: "SENT" },
      // originalMediaId dolu = yorum bir reklam kopyasindan geldi.
      select: { createdAt: true, mediaId: true, originalMediaId: true, commentId: true },
    }),
    prisma.linkClick.findMany({
      where: { workspaceId, automationId: id, createdAt },
      select: { createdAt: true, referrer: true, userAgent: true, ipHash: true },
    }),
    prisma.dmLog.findMany({
      // Huninin geri kalani gibi YALNIZCA yorumlar: kampanya listesi
      // (filtreli) "0 failed" derken bu ekran sentetik satirlarin hatalarini
      // sayarsa ayni kampanya iki ekranda farkli gorunur.
      where: { ...yorumKapsami, status: "FAILED" },
      select: { errorMessage: true },
    }),
  ]);

  const data = buildCampaignAnalytics({
    dayKeys: dayKeys(range),
    comments,
    sentAt: sentRows.map((r) => r.createdAt),
    // Sentetik defter satirlari (emailgate:/reveal:/dm:) yorum DEGIL; kaynak
    // kirilimine girerlerse "izlenmeyen" kovasini sisirirler.
    // Sorgu zaten yalnizca yorumlari getiriyor (yorumKapsami).
    sentSources: sentRows.map((r) => ({
      mediaId: r.mediaId,
      originalMediaId: r.originalMediaId,
    })),
    clicks: clickRows,
    failures: failedRows.map((r) => r.errorMessage),
  });

  return NextResponse.json(
    {
      success: true,
      data: { range: { from: range.fromKey, to: range.toKey }, ...data },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
