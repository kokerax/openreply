/**
 * Webhook olaylarini sinifla — "eslesmedi" tek basina alarm degildir.
 *
 * Panel `workspaceId === null` olan her satiri "unmatched" diye amber
 * isaretliyordu. Olcum (2026-09-09, son 7 gun): 2.471 olayin 2.034'u boyle
 * gorunuyordu, yani %82. Operator bunu "webhook'larin dortte ucu duşuyor"
 * diye okur ve olmayan bir arizayi kovalar.
 *
 * Gercekte uc AYRI sinif var ve ikisi TASARIM GEREGI islenmez:
 *
 *   kendi-yankisi  1.050  Kendi yorum cevabimiz (from.id = bizim IG kimligi)
 *                         ve kendi giden DM'lerimiz (message.is_echo = true).
 *                         Bunlara cevap vermek sonsuz dongu olurdu.
 *   akis-disi        984  Kampanya akisinda olmayan birinin bize yazdigi DM.
 *                         Isleyecek bir sey yok; spam da degil.
 *   eslesti          437  Isledigimiz yorum ve akis ici mesajlar.
 *
 * Yani "eslesmedi" sayisinin buyuk olmasi saglikli calismanin BELIRTISI.
 * Gercekten dikkat isteyen sinif yalnizca beklenmeyen bir kimlikten gelen
 * ve akisa oturmayan olaylar olurdu; onlari `akis-disi` sayiyoruz ve
 * sayilarini gizlemiyoruz.
 */

export type WebhookSinifi = "eslesti" | "kendi-yankisi" | "akis-disi";

/** Yalnizca okudugumuz alanlar; Meta yuku cok daha genis. */
interface WebhookYuku {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { from?: { id?: string } };
    }>;
    messaging?: Array<{
      sender?: { id?: string };
      message?: { is_echo?: boolean };
    }>;
  }>;
}

/**
 * Olayi baslatan kimlik. Yorum olaylarinda `from.id`, mesaj olaylarinda
 * `sender.id`. Bulunamazsa null — SEKLI VARSAYMIYORUZ, sadece okuyoruz.
 */
export function webhookAktoru(payload: unknown): string | null {
  const y = payload as WebhookYuku | null;
  const girdi = y?.entry?.[0];
  if (!girdi) return null;
  const yorumdan = girdi.changes?.[0]?.value?.from?.id;
  if (typeof yorumdan === "string") return yorumdan;
  const mesajdan = girdi.messaging?.[0]?.sender?.id;
  return typeof mesajdan === "string" ? mesajdan : null;
}

/** Meta kendi gonderdigimiz DM'i `is_echo` ile geri yolluyor. */
export function yankiMi(payload: unknown): boolean {
  const y = payload as WebhookYuku | null;
  return y?.entry?.[0]?.messaging?.[0]?.message?.is_echo === true;
}

export function webhookSinifi(
  workspaceId: string | null | undefined,
  payload: unknown,
  kendiKimlikler: ReadonlySet<string>
): WebhookSinifi {
  if (workspaceId) return "eslesti";
  if (yankiMi(payload)) return "kendi-yankisi";
  const aktor = webhookAktoru(payload);
  if (aktor !== null && kendiKimlikler.has(aktor)) return "kendi-yankisi";
  return "akis-disi";
}

/** Panelde ozet satiri icin: her sinifin adedi. */
export function webhookOzeti(
  olaylar: Array<{ workspaceId: string | null; payload: unknown }>,
  kendiKimlikler: ReadonlySet<string>
): Record<WebhookSinifi, number> {
  const ozet: Record<WebhookSinifi, number> = {
    eslesti: 0,
    "kendi-yankisi": 0,
    "akis-disi": 0,
  };
  for (const o of olaylar) {
    ozet[webhookSinifi(o.workspaceId, o.payload, kendiKimlikler)] += 1;
  }
  return ozet;
}
