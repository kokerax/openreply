/**
 * Webhook baglantisinin GORUNEN durumu — bayraktan degil DAVRANISTAN.
 *
 * `InstagramAccount.webhookSubscribed` yalnizca OAuth geri donusunde bir kez
 * yaziliyor ve bir daha guncellenmiyor. Canli olcum (2026-09-09):
 *
 *   webhookSubscribed = false
 *   son 24 saatte gelen webhook olayi = 502
 *
 * Yani Settings sayfasi CALISAN bir baglantiya amber "Webhook pending"
 * diyordu. Operator ya olmayan bir arizayi kovalar ya da abonelik akisini
 * bosuna yeniden kosturur.
 *
 * Olcut davranis: olay geliyorsa baglanti calisiyordur. Celiski GIZLENMEZ,
 * ayri bir durumla ROZETLENIR — bayrak bayat oldugunu soylemek, bayragi
 * sessizce dogru saymaktan da yok saymaktan da durustur.
 */

export type WebhookDurumu =
  /** Olay geliyor ve bayrak da aboneyim diyor. */
  | "calisiyor"
  /** Olay GELIYOR ama bayrak "abone degil" diyor — bayrak bayat. */
  | "bayrak-bayat"
  /** Bayrak aboneyim diyor ama son donemde olay yok — hesap sessiz olabilir. */
  | "abone-sessiz"
  /** Ne bayrak ne olay: kurulum gercekten tamamlanmamis. */
  | "bekliyor";

/** Bu suredeki bir olay "baglanti calisiyor" saymak icin yeterli. */
export const TAZE_PENCERE_MS = 24 * 60 * 60 * 1000;

export function webhookDurumu(
  abone: boolean,
  sonOlay: Date | string | null | undefined,
  simdi: Date = new Date()
): WebhookDurumu {
  const t = sonOlay ? new Date(sonOlay).getTime() : NaN;
  // Gecersiz tarih "olay yok" sayilir; cokmez.
  const taze = Number.isFinite(t) && simdi.getTime() - t <= TAZE_PENCERE_MS;

  if (taze) return abone ? "calisiyor" : "bayrak-bayat";
  return abone ? "abone-sessiz" : "bekliyor";
}

/** Panelde gosterilecek etiket ve ton. */
export function webhookRozeti(durum: WebhookDurumu): {
  label: string;
  status: "ACTIVE" | "PENDING";
  hint: string;
} {
  switch (durum) {
    case "calisiyor":
      return { label: "Webhook ready", status: "ACTIVE", hint: "Events arriving." };
    case "bayrak-bayat":
      return {
        label: "Webhook receiving",
        status: "ACTIVE",
        hint: "Events are arriving, but the subscription flag from connect time says otherwise. The flag is stale, not the connection.",
      };
    case "abone-sessiz":
      return {
        label: "Webhook subscribed",
        status: "ACTIVE",
        hint: "Subscribed; no events in the last 24h (a quiet account looks the same).",
      };
    case "bekliyor":
      return {
        label: "Webhook pending",
        status: "PENDING",
        hint: "No subscription and no events received.",
      };
  }
}
