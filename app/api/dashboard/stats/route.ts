import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId, getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { dayKeys, resolveDateRange } from "@/lib/utils/date-range";
import {
  bolgedeGunBasi,
  resolveTimeZone,
  yerelGunAnahtari,
} from "@/lib/reports/trend-helpers";
import {
  calculateCtr,
  normalizeTopKeywords,
  summarizeDmStatuses,
} from "@/lib/tracking/analytics";

/**
 * Dashboard stats.
 *
 * Range-scoped fields (`dmsSentMonth`, `dmsSkippedMonth`, `dmsFailedMonth`,
 * `clicksThisMonth`, `ctrThisMonth`, `dailyDMs`) follow `from`/`to`
 * (default: last 30 days) — the "Month" names are kept so the client
 * contract does not change. `dmsSentToday` / `dmsSentWeek` are fixed windows
 * and `totalDMs` / `totalClicks` / `totalAutomations` are lifetime.
 */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const userId = await getCurrentUserId();

  const now = new Date();
  // "Bugun" SUNUCUNUN yerel saatinden hesaplaniyordu. Vercel UTC'de kostugu
  // icin Istanbul'daki kullaniciya bugun saat 03:00'te basliyor, gece yarisi
  // ile 03:00 arasindaki gonderimler "bugun" sayilmiyordu. Panel tarayicinin
  // bolgesini `tz` ile gonderiyor (trend sayfasindaki desenin aynisi).
  // Varsayilan UTC: ciplak API cagrilarinin sozlesmesi degismesin. Panel
  // tarayicinin bolgesini HER ISTEKTE `tz` ile gonderiyor.
  const tzParam = request.nextUrl.searchParams.get("tz");
  const timeZone = (tzParam ? resolveTimeZone(tzParam) : "UTC") ?? "UTC";
  const todayStart = bolgedeGunBasi(timeZone, now);
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 3600_000);
  const range = resolveDateRange(request.nextUrl.searchParams, 30);
  const inRange = { createdAt: { gte: range.from, lt: range.toExclusive } };

  const requestedInstagramAccountId =
    request.nextUrl.searchParams.get("instagramAccountId");
  const selectedAccountId =
    requestedInstagramAccountId && requestedInstagramAccountId !== "all"
      ? requestedInstagramAccountId
      : null;
  const accountFilter = selectedAccountId
    ? { instagramAccountId: selectedAccountId }
    : {};

  try {
    const [
      workspace,
      instagramAccount,
      instagramAccounts,
      totalAutomations,
      activeAutomations,
      dmsSentToday,
      dmsSentWeek,
      dmsSentInRange,
      totalDMs,
      dmStatusCountsInRange,
      clicksInRange,
      totalClicks,
      topKeywordRows,
      recentLogs,
      user,
      contactRows,
      sentRows,
    ] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          name: true,
          dmsSentThisPeriod: true,
        },
      }),
      prisma.instagramAccount.findFirst({
        where: { workspaceId },
        orderBy: { connectedAt: "desc" },
        select: {
          id: true,
          username: true,
          instagramId: true,
          tokenExpiresAt: true,
          webhookSubscribed: true,
        },
      }),
      prisma.instagramAccount.findMany({
        where: { workspaceId },
        orderBy: { connectedAt: "desc" },
        select: {
          id: true,
          username: true,
          instagramId: true,
          name: true,
          tokenExpiresAt: true,
          webhookSubscribed: true,
        },
      }),
      prisma.automation.count({ where: { workspaceId, ...accountFilter } }),
      prisma.automation.count({
        where: { workspaceId, isActive: true, ...accountFilter },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          status: "SENT",
          createdAt: { gte: todayStart },
          ...accountFilter,
        },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          status: "SENT",
          createdAt: { gte: weekStart },
          ...accountFilter,
        },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          status: "SENT",
          ...inRange,
          ...accountFilter,
        },
      }),
      prisma.dmLog.count({
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          status: "SENT",
          ...accountFilter,
        },
      }),
      prisma.dmLog.groupBy({
        by: ["status"],
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          ...inRange,
          ...accountFilter,
        },
        _count: { _all: true },
      }),
      prisma.linkClick.count({
        where: { workspaceId, ...inRange, ...accountFilter },
      }),
      prisma.linkClick.count({ where: { workspaceId, ...accountFilter } }),
      prisma.dmLog.groupBy({
        by: ["matchedKeyword"],
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          matchedKeyword: { not: null },
          ...accountFilter,
        },
        _count: { _all: true },
      }),
      prisma.dmLog.findMany({
        // Muhurler "son aktivite"de gercek gonderim gibi gorunurdu.
        where: { workspaceId, isBackfill: false, ...accountFilter },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          automation: { select: { name: true } },
          instagramAccount: { select: { username: true } },
        },
      }),
      userId
        ? prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, email: true },
          })
        : Promise.resolve(null),
      // Distinct people who have interacted, counted as "contacts".
      prisma.dmLog.findMany({
        // Ulasilan benzersiz kisi: muhurlenenlere bu sistem mesaj gondermedi.
        where: { workspaceId, isBackfill: false, ...accountFilter },
        distinct: ["commenterId"],
        select: { commenterId: true },
      }),
      // One query for the whole series instead of one count per day.
      prisma.dmLog.findMany({
        where: {
          workspaceId,
          // Goc muhurleri bu sistemin gonderimi DEGIL — sayimdan cikar.
          isBackfill: false,
          status: "SENT",
          ...inRange,
          ...accountFilter,
        },
        select: { createdAt: true },
      }),
    ]);

    // Sifir dolgulu gunluk seri, KULLANICININ bolgesindeki takvim gunune gore.
    // Iskelet hala UTC gunlerinden uretiliyor (aralik sinirlari oyle); +03 gibi
    // bolgelerde araligin son UTC gununun son saatleri BIR SONRAKI yerel gune
    // duser. `has` kontroluyle atlamak o satirlari SESSIZCE dusururdu — bunun
    // yerine eksik anahtar ekleniyor ve seri tarihe gore siralaniyor.
    // Iskelet anahtarlar ARALIGIN YEREL takviminden uretiliyor: UTC gunlerinden
    // uretip `has` ile suzmek, +03 gibi bolgelerde araligin son saatlerini
    // (bir sonraki yerel gune dusen satirlari) SESSIZCE dusururdu. Aralik disi
    // satirlar yine elenir — DB filtresi zaten eliyor, burasi ikinci kapi.
    const ilkGun = yerelGunAnahtari(range.from, timeZone);
    const sonGun = yerelGunAnahtari(
      new Date(range.toExclusive.getTime() - 1),
      timeZone
    );
    const perDay = new Map<string, number>();
    for (const k of dayKeys(range)) perDay.set(k, 0);
    perDay.set(ilkGun, perDay.get(ilkGun) ?? 0);
    perDay.set(sonGun, perDay.get(sonGun) ?? 0);
    for (const row of sentRows) {
      const key = yerelGunAnahtari(row.createdAt, timeZone);
      if (key < ilkGun || key > sonGun) continue;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    const dailyDMs = [...perDay.entries()]
      .filter(([d]) => d >= ilkGun && d <= sonGun)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    const statusSummary = summarizeDmStatuses(
      dmStatusCountsInRange.map((row) => ({
        status: row.status,
        _count: row._count._all,
      }))
    );
    const topKeywords = normalizeTopKeywords(
      topKeywordRows.map((row) => ({
        matchedKeyword: row.matchedKeyword,
        _count: row._count._all,
      }))
    );

    const firstName =
      user?.name?.trim().split(/\s+/)[0] ||
      user?.email?.split("@")[0] ||
      null;

    return NextResponse.json({
      success: true,
      data: {
        userName: firstName,
        contactsCount: contactRows.length,
        workspace,
        instagramAccount,
        instagramAccounts,
        selectedInstagramAccountId: selectedAccountId,
        range: { from: range.fromKey, to: range.toKey, days: range.days },
        // Panel "Today"in HANGI takvime gore oldugunu yazabilsin diye.
        timeZone,
        totalAutomations,
        activeAutomations,
        dmsSentToday,
        dmsSentWeek,
        dmsSentMonth: dmsSentInRange,
        dmsSkippedMonth: statusSummary.skipped,
        dmsFailedMonth: statusSummary.failed,
        totalDMs,
        clicksThisMonth: clicksInRange,
        totalClicks,
        ctrThisMonth: calculateCtr(clicksInRange, dmsSentInRange),
        topKeywords,
        dailyDMs,
        recentLogs,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load stats";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
