import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { epostaKapisiHunisi } from "@/lib/ops/eposta-kapisi";
import { resolveDateRange } from "@/lib/utils/date-range";

export const runtime = "nodejs";

/**
 * GET /api/leads/funnel?from=&to=&instagramAccountId=
 *
 * Leads listesi "kac adres topladik" sorusunu cevapliyor; bu uc "kac kisiye
 * sorduk" sorusunu ekliyor. Ayri endpoint: liste sayfalanip siralanirken
 * huni araligin TAMAMINI okur, ikisini tek sorguda birlestirmek listeyi
 * yavaslatirdi.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const range = resolveDateRange(request.nextUrl.searchParams, 30);
  const sp = request.nextUrl.searchParams;
  // Leads sayfasinin filtresi KAMPANYA bazli; hesap filtresi de kabul
  // ediliyor ki baska bir yuzeyden cagrilinca ayni kapsami verebilsin.
  const secili = (ad: string) => {
    const v = sp.get(ad);
    return v && v !== "all" ? v : undefined;
  };

  const data = await epostaKapisiHunisi(ctx.workspaceId, range.from, range.toExclusive, {
    instagramAccountId: secili("instagramAccountId"),
    automationId: secili("automationId"),
  });

  return NextResponse.json({
    success: true,
    data: { ...data, range: { from: range.fromKey, to: range.toKey } },
  });
}
