/**
 * Kuyrugu bosaltan cron ucu — 7/24 acik worker surecinin yerini alir.
 *
 * Vercel Cron'dan dakikada bir tetiklenir. Fonksiyon suresi sinirli oldugu icin
 * `kuyrugunuBosalt` kendi zaman butcesini gozetir; yarim kalan isler PENDING'e
 * geri doner ve bir sonraki tur devam eder, is kaybi olmaz.
 */
import { NextRequest, NextResponse } from "next/server";
import { kuyrugunuBosalt } from "@/lib/queue/dm-worker";
import { eskileriTemizle } from "@/lib/queue/pg-queue";
import { sayaclariTemizle } from "@/lib/utils/pg-rate-limiter";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function yetkili(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  // Vercel Cron `Bearer <CRON_SECRET>` gonderir; elle tetikleme icin ?key= de kabul.
  if (header === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("key") === secret;
}

export async function GET(request: NextRequest) {
  if (!yetkili(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const basla = Date.now();
  try {
    const sonuc = await kuyrugunuBosalt({ enFazla: 25, sureSiniriMs: 240_000 });

    // Kalp atisi: serverless kurulumda "worker ayakta mi" sorusunun karsiligi
    // "son cron ne zaman kostu"dur. Saglik ucu bunu okuyor.
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: process.env.VERCEL_REGION ?? "vercel",
      startedAt: new Date(basla).toISOString(),
    });

    // Temizlik bosaltmadan SONRA: tamamlanmis is silinmezse ayni dedupeKey bir
    // daha kuyruga giremez (bkz. pg-queue.eskileriTemizle).
    const temizlik = await eskileriTemizle();
    const sayac = await sayaclariTemizle();

    return NextResponse.json({
      success: true,
      ...sonuc,
      temizlenen: { ...temizlik, sayac },
      sureMs: Date.now() - basla,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "drain failed" },
      { status: 500 }
    );
  }
}
