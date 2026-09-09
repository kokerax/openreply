/**
 * Bir DM'in okunabilir onizlemesi.
 *
 * ## Neden gerekli
 *
 * Inbox 50 sohbetin 32'sinde (%64) "(no text)" gosteriyordu. Sebep Meta'nin
 * `message` alanini yalnizca DUZ METIN mesajlar icin doldurmasi:
 *
 *   Butonlu DM (bizim kampanya mesajimiz)
 *     message: ""
 *     attachments.data[0].generic_template.title = "🙋‍♂️ Merhaba ...,
 *       yorumun icin tesekkurler! ... asagidaki butona tikla"
 *     ...generic_template.cta[0].title = "YOLLA"
 *
 *   Reel paylasimi (kisi bize gonderi yolluyor)
 *     message: ""
 *     shares.data[0].link = "https://www.instagram.com/reel/..."
 *
 * Yani panel, otomasyonun gonderdigi ASIL mesaji hic gostermiyordu:
 * operator "ne yolladik" sorusunu Inbox'tan cevaplayamiyordu.
 *
 * Sekil VARSAYILMIYOR — her alan okunup kontrol ediliyor; taninmayan bir
 * ek gelirse "(ek)" deniyor, cunku sessizce bos birakmak bu hatanin ta
 * kendisiydi.
 */

export interface OnizlenebilirMesaj {
  message?: string | null;
  attachments?: {
    data?: Array<{
      generic_template?: { title?: string; cta?: Array<{ title?: string }> };
      image_data?: unknown;
      video_data?: unknown;
      file_url?: string;
      type?: string;
    }>;
  } | null;
  shares?: { data?: Array<{ link?: string }> } | null;
  story?: { link?: string } | null;
}

/** Buton etiketi onizlemede koseli parantezle gosteriliyor. */
function butonEtiketi(sablon: { cta?: Array<{ title?: string }> }): string {
  const t = sablon.cta?.[0]?.title?.trim();
  return t ? ` [${t}]` : "";
}

/**
 * Gosterilecek metin. Bulunamazsa bos dize doner — cagiran taraf o zaman
 * kendi bos-durum metnini yazar.
 */
export function mesajOnizlemesi(m: OnizlenebilirMesaj | null | undefined): string {
  if (!m) return "";
  const duz = m.message?.trim();
  if (duz) return duz;

  const ek = m.attachments?.data?.[0];
  const sablon = ek?.generic_template;
  const baslik = sablon?.title?.trim();
  // Butonlu kampanya mesaji: asil metin BURADA.
  if (baslik) return baslik + butonEtiketi(sablon!);

  // GERCEK ICERIK genel ek etiketini YENER. Ilk surumde `attachments` dali
  // kosulsuz donuyordu; hem gorsel eki hem gonderi paylasimi tasiyan bir
  // mesaj "(görsel)" yaziyor ve linki kaybediyordu.
  const paylasim = m.shares?.data?.[0]?.link?.trim();
  if (paylasim) return `(gönderi paylaştı) ${paylasim}`;

  const hikaye = m.story?.link?.trim();
  if (hikaye) return `(hikâye) ${hikaye}`;

  if (ek) {
    if (sablon) return `(butonlu mesaj)${butonEtiketi(sablon)}`;
    if (ek.image_data) return "(görsel)";
    if (ek.video_data) return "(video)";
    if (typeof ek.type === "string" && ek.type.trim()) return `(${ek.type.trim()})`;
    if (ek.file_url) return "(dosya)";
    return "(ek)";
  }

  return "";
}
