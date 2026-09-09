/**
 * Pure helpers for the trend analysis endpoint (app/api/instagram/trend).
 * Kept out of the route file so they can be unit-tested without auth/prisma.
 */

/**
 * Used when the request carries no `tz`. Istanbul because the accounts this
 * instance was built for post from there; the page always sends the browser's
 * zone, so this only applies to bare API calls.
 */
export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

/**
 * Validate an IANA timezone name. Returns the canonical name, `null` when the
 * runtime rejects it, and the default when nothing was supplied.
 */
export function resolveTimeZone(
  tz: string | null | undefined
): string | null {
  const trimmed = tz?.trim();
  if (!trimmed) return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 0–23 */
  hour: number;
}

// One formatter per zone per process: constructing Intl.DateTimeFormat is
// expensive and the trend endpoint calls this once per post.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      hour: "numeric",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Year / month / hour-of-day of `date` as seen in `timeZone`, including DST —
 * which a fixed UTC offset cannot express.
 */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  // Some engines print midnight as "24" even with h23; normalize.
  const rawHour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    hour: rawHour === 24 ? 0 : rawHour,
  };
}

/** "2026 H1" / "2026 H2" — the period label used by the trend table. */
export function halfYearLabel(parts: LocalParts): string {
  return `${parts.year} ${parts.month <= 6 ? "H1" : "H2"}`;
}

/**
 * Turkish call-to-action wording used in the captions this instance was
 * built for ("yorumlara yaz", "takip et ve …").
 */
export const CTA_PATTERN_TR = /yorumlar|takip et ve/i;
/** English equivalents so non-Turkish accounts get a CTA split too. */
export const CTA_PATTERN_EN = /link in bio|comment|dm me/i;
/** Either language counts as a call to action. */
export const CTA_PATTERN = new RegExp(
  `${CTA_PATTERN_TR.source}|${CTA_PATTERN_EN.source}`,
  "i"
);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * `date` an'inin `timeZone`'daki UTC ofseti (ms). DST dahil dogru.
 *
 * Sabit bir ofset sayisi yeterli DEGIL: yaz saati uygulayan bolgelerde ofset
 * yil icinde degisir, ve gecis gunlerinde gunun uzunlugu 23/25 saattir.
 */
function bolgeOfsetiMs(date: Date, timeZone: string): number {
  const parcalar = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const al = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parcalar.find((p) => p.type === t)?.value ?? NaN);
  const utcmis = Date.UTC(
    al("year"),
    al("month") - 1,
    al("day"),
    al("hour") % 24,
    al("minute"),
    al("second")
  );
  return utcmis - date.getTime();
}

/** `date`in `timeZone`'daki takvim gunu, "YYYY-MM-DD". */
export function yerelGunAnahtari(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * `timeZone`'da BUGUNUN basladigi an (UTC Date olarak).
 *
 * `new Date(y, m, d)` SUNUCUNUN yerel saatini kullanir; Vercel UTC'de kostugu
 * icin Istanbul'daki kullaniciya "bugun" saat 03:00'te basliyor gorunuyordu ve
 * gece yarisi ile 03:00 arasi gonderimler "bugun" sayilmiyordu.
 */
export function bolgedeGunBasi(timeZone: string, simdi: Date = new Date()): Date {
  const ofset = bolgeOfsetiMs(simdi, timeZone);
  const yerel = new Date(simdi.getTime() + ofset);
  const yerelGeceYarisi = Date.UTC(
    yerel.getUTCFullYear(),
    yerel.getUTCMonth(),
    yerel.getUTCDate()
  );
  // Ofseti gece yarisi ANINDA yeniden hesapla: DST gecisi olan gunlerde
  // simdiki ofset ile gece yarisindaki ofset FARKLI olabilir.
  let sonuc = new Date(yerelGeceYarisi - ofset);
  const ofset2 = bolgeOfsetiMs(sonuc, timeZone);
  if (ofset2 !== ofset) sonuc = new Date(yerelGeceYarisi - ofset2);
  return sonuc;
}


/**
 * Iki grubun ORTAK donemleri — her ikisinde de en az `esik` icerik bulunan
 * yariyillar.
 *
 * ## Neden gerekli
 *
 * Yorum cagrisi karsilastirmasi 2026-09'da soyle gorunuyordu:
 *
 *   Cagri var  134 icerik  medyan yorum 52  yorum/begeni %20
 *   Cagri yok   17 icerik  medyan yorum 94  yorum/begeni %31,2
 *
 * Yani "cagri koymayinca daha cok yorum geliyor" gibi okunuyordu. Gruplarin
 * TARIH dagilimina bakinca sebep ortaya cikti: "cagri yok"un 17 icerigin
 * 15'i 2025'ten, "cagri var" ise 2024-2026'ya yayilmis. Hesabin medyan
 * izlenmesi 2025'te 28-40K iken 2026'da 5-7K'ya dusmus. Karsilastirma
 * cagriyi degil DONEMI olcuyordu.
 *
 * Gruplar ayni donemlerden secilmezse metrik calisir ama yanlis buyuklugu
 * olcer — ve panel bunu nedensel bir cumleyle sunar.
 */
export function ortakDonemler(
  a: ReadonlyArray<{ half: string }>,
  b: ReadonlyArray<{ half: string }>,
  esik: number
): string[] {
  const say = (g: ReadonlyArray<{ half: string }>) => {
    const m = new Map<string, number>();
    for (const p of g) m.set(p.half, (m.get(p.half) ?? 0) + 1);
    return m;
  };
  const sa = say(a);
  const sb = say(b);
  return [...sa.keys()]
    .filter((d) => (sa.get(d) ?? 0) >= esik && (sb.get(d) ?? 0) >= esik)
    .sort();
}
