const SKIPPED_PREFIX = "SKIPPED_";

export interface StatusCountRow {
  status: string;
  _count: number | { status?: number; _all?: number };
}

export interface KeywordCountRow {
  matchedKeyword: string | null;
  _count: number | { matchedKeyword?: number; _all?: number };
}

function getCount(value: StatusCountRow["_count"] | KeywordCountRow["_count"]) {
  if (typeof value === "number") return value;
  if ("status" in value && typeof value.status === "number") {
    return value.status;
  }
  if ("matchedKeyword" in value && typeof value.matchedKeyword === "number") {
    return value.matchedKeyword;
  }
  return value._all ?? 0;
}

/**
 * Tiklama orani.
 *
 * `clicks` icin TEKIL tiklayan sayisi verilmeli (ayni `ipHash` bir kez).
 * Ham tiklamayla cagirmak orani sisirir: bir kisi linke bes kez basinca
 * "%500 tiklama orani" cikardi ve alttaki `Math.min` bunu 100'e kirpip
 * hatayi gizlerdi.
 *
 * Kirpma yine duruyor cunku pay ve payda YAPISAL olarak ayni evrenden
 * degil: `LinkClick` tablosunda alici referansi yok (yalniz trackedLinkId +
 * ipHash), yani 40 gun once gonderilmis bir DM'e bugun gelen tiklama paya
 * girer, o gonderim paydaya girmez. Bu bir yaklasiktir; cagiran taraf
 * `clicksExceedSends` ile kullaniciya bunu soyler.
 */
export function calculateCtr(clicks: number, sent: number) {
  if (sent <= 0) return 0;
  return Math.min(100, Number(((clicks / sent) * 100).toFixed(1)));
}

export function summarizeDmStatuses(rows: StatusCountRow[]) {
  return rows.reduce(
    (summary, row) => {
      const count = getCount(row._count);
      if (row.status === "SENT") summary.sent += count;
      if (row.status === "FAILED") summary.failed += count;
      if (row.status.startsWith(SKIPPED_PREFIX)) summary.skipped += count;
      return summary;
    },
    { sent: 0, skipped: 0, failed: 0 }
  );
}

export function normalizeTopKeywords(rows: KeywordCountRow[], limit = 5) {
  return rows
    .filter((row) => row.matchedKeyword)
    .map((row) => ({
      keyword: row.matchedKeyword as string,
      count: getCount(row._count),
    }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, limit);
}
