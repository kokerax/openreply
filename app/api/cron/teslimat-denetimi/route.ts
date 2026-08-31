/**
 * Teslimat denetimi — "sessizce hiçbir şey yapmama" arızasını yakalar.
 *
 * NEDEN VAR: 2026-08-31'de sistem üç ayrı şekilde sessizce durdu ve hiçbiri
 * alarm üretmedi, çünkü her katman kendi açısından "sağlıklı"ydı:
 *
 *   1. `instagramId` yanlıştı → webhook geldi, PROCESSED yazıldı, hesap
 *      bulunamadığı için hiçbir DM üretilmedi. Sağlık ucu "ok" diyordu.
 *   2. `TrackedLink` yoktu → link düz metin gitti, Instagram 508 ile engelledi;
 *      kişiler açılış DM'ini alıp butona bastı ve karşılığında hiçbir şey almadı.
 *   3. Mühürlenen 59 kayıt "SENT" göründü ama kimseye ulaşmamıştı.
 *
 * Ortak nokta: **kayıt "başarılı" diyordu, gerçek teslimat yoktu.** Bu yüzden
 * denetim DmLog'a DEĞİL, Instagram'ın kendi verisine bakar:
 *   - eşleşen yorum var mı?  (Instagram'dan)
 *   - o kişiyle sohbet, yorumdan SONRA güncellenmiş mi?  (Instagram'dan)
 *
 * Bu iki soru arasındaki fark = gerçekten kaçan kişi. Kod ne derse desin.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const V = process.env.META_GRAPH_API_VERSION ?? "v25.0";
/** Kaç saat geriye bakılacak. Kısa tutuluyor: amaç arızayı ERKEN görmek. */
const PENCERE_SAAT = 6;
/** Bu kadar kişi kaçmışsa alarm. 1-2 kişi geçici hata olabilir; 5 desendir. */
const ALARM_ESIGI = 5;

function yetkili(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("key") === secret;
}

async function telegram(mesaj: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHANNEL;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: mesaj, disable_web_page_preview: true }),
    });
  } catch {
    // Bildirim gidemezse denetim yine de kaydedilir; sessizce yutulmaz.
  }
}

export async function GET(request: NextRequest) {
  if (!yetkili(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const hesap = await prisma.instagramAccount.findFirst();
  if (!hesap) {
    return NextResponse.json({ success: false, error: "Instagram hesabi yok" }, { status: 404 });
  }
  const akislar = await prisma.automation.findMany({ where: { isActive: true } });
  if (akislar.length === 0) {
    return NextResponse.json({ success: true, not: "aktif akis yok, denetim atlandi" });
  }

  const T = decryptToken(hesap.accessToken);
  const esik = Date.now() - PENCERE_SAAT * 3600_000;
  const uyarilar: string[] = [];

  // ── 1) Eşleşen yorumları Instagram'dan topla ────────────────────────────
  const mr = await (
    await fetch(`https://graph.instagram.com/${V}/me/media?fields=id&limit=12&access_token=${T}`)
  ).json();
  if (mr.error) {
    // Token/erişim arızası da sessiz durmanın bir biçimidir — alarm.
    const m = `[OpenReply] DENETIM: Instagram'dan icerik alinamadi — ${mr.error.message}`;
    await telegram(m);
    return NextResponse.json({ success: false, error: mr.error.message }, { status: 502 });
  }

  const eslesen: { id: string; uid: string; ts: string; text: string }[] = [];
  for (const m of mr.data ?? []) {
    const b = await (
      await fetch(
        `https://graph.instagram.com/${V}/${m.id}/comments?fields=id,text,timestamp,from&limit=50&access_token=${T}`
      )
    ).json();
    if (b.error) continue;
    for (const c of b.data ?? []) {
      if (Date.parse(c.timestamp) < esik) continue;
      if (!c.from?.id || c.from.id === hesap.instagramId) continue;
      const uyan = akislar.some(
        (a) => matchKeywords(c.text ?? "", a.keywords, a.wholeWordMatch).matched
      );
      if (uyan) eslesen.push({ id: c.id, uid: c.from.id, ts: c.timestamp, text: c.text ?? "" });
    }
  }

  // ── 2) Gerçek teslimat: hesabın kendi sohbetleri ────────────────────────
  const sohbet = new Map<string, string>();
  let url: string | null =
    `https://graph.instagram.com/${V}/me/conversations?fields=participants,updated_time&limit=100&access_token=${T}`;
  for (let s = 0; url && s < 6; s++) {
    const b = await (await fetch(url)).json();
    if (b.error) break;
    for (const k of b.data ?? [])
      for (const p of k.participants?.data ?? []) sohbet.set(p.id, k.updated_time);
    url = b.paging?.next ?? null;
  }

  // Kişi başına en eski eşleşen yorum — bir kişi için tek kayıt yeter.
  const kisiBasi = new Map<string, (typeof eslesen)[number]>();
  for (const c of [...eslesen].sort((a, b) => a.ts.localeCompare(b.ts))) {
    if (!kisiBasi.has(c.uid)) kisiBasi.set(c.uid, c);
  }
  const kacan = [...kisiBasi.values()].filter((c) => {
    const t = sohbet.get(c.uid);
    return !(t && Date.parse(t) >= Date.parse(c.ts));
  });

  if (kacan.length >= ALARM_ESIGI) {
    uyarilar.push(
      `${kacan.length} kisi eslesen yorum yazdi ama HIC mesaj almadi ` +
        `(son ${PENCERE_SAAT} saat, ${kisiBasi.size} kisiden).`
    );
  }

  // ── 3) Yapılandırma bütünlüğü: bugün kırılan üç şeyin nöbetçisi ─────────
  // Bunlar tek tek "sessiz arıza" ureten eksikliklerdi; varlıklarını sürekli kontrol et.
  if (!/^\d+$/.test(hesap.instagramId)) {
    uyarilar.push(`instagramId sayisal degil: ${hesap.instagramId}`);
  }
  for (const a of akislar) {
    const linkSayisi = await prisma.trackedLink.count({ where: { automationId: a.id } });
    // Link iceren bir mesaji TrackedLink olmadan gondermek onu duz metne dusurur
    // ve Instagram duz metindeki linki 508 ile engeller (2026-08-31'de tam bu oldu).
    if (linkSayisi === 0 && /https?:\/\//.test(a.dmMessage)) {
      uyarilar.push(
        `"${a.name}" akisinda TrackedLink YOK ama mesajda link var — ` +
          `duz metin olarak gonderilir ve Instagram engeller.`
      );
    }
  }

  // ── 4) Kuyruk tikanikligi ───────────────────────────────────────────────
  const takilan = await prisma.queueJob.count({
    where: { status: "PENDING", runAt: { lt: new Date(Date.now() - 15 * 60_000) } },
  });
  if (takilan > 0) uyarilar.push(`${takilan} is 15 dakikadir kuyrukta bekliyor.`);

  const basarisiz = await prisma.dmLog.count({
    where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  const gonderilen = await prisma.dmLog.count({
    where: { status: "SENT", createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  if (basarisiz > 0 && basarisiz > gonderilen) {
    uyarilar.push(`Son saatte ${basarisiz} basarisiz / ${gonderilen} basarili — oran ters.`);
  }

  if (uyarilar.length > 0) {
    await telegram(
      "[OpenReply] TESLIMAT DENETIMI\n" +
        uyarilar.map((u) => "- " + u).join("\n") +
        (kacan.length
          ? `\n\nOrnek kaciranlar:\n` +
            kacan.slice(0, 5).map((c) => `  ${c.ts.slice(0, 16)} ${JSON.stringify(c.text.slice(0, 20))}`).join("\n")
          : "")
    );
    await prisma.operationalEvent.create({
      data: {
        source: "HEALTH",
        level: "WARNING",
        message: "Teslimat denetimi uyari uretti",
        payload: { uyarilar, kacan: kacan.length, incelenen: kisiBasi.size },
      },
    });
  }

  return NextResponse.json({
    success: true,
    pencereSaat: PENCERE_SAAT,
    eslesenYorum: eslesen.length,
    incelenenKisi: kisiBasi.size,
    mesajAlmayan: kacan.length,
    uyarilar,
    alarmVerildi: uyarilar.length > 0,
  });
}
