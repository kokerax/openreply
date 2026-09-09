/**
 * Defter satirlarinin okunabilir etiketi.
 *
 * DmLog'un `commentText` alani gercek yorumlarda kisinin yazdigi metni
 * tasiyor; defter satirlarinda ise sabit bir etiket. O etiketler zaman
 * icinde iki dilde yazilmis:
 *
 *   "(e-posta bekleniyor)"  130
 *   "(button tap)"          113
 *   "(e-posta alindi)"       67
 *   "(takip istemi)"          6
 *
 * Panelin geri kalani Ingilizce, yani DM Logs tablosunun ayni sutununda
 * "(button tap)" ile "(e-posta alindi)" yan yana duruyordu.
 *
 * Etiket VERITABANINDA duruyor, dolayisiyla yalnizca kaynagi degistirmek
 * eski 316 satiri duzeltmez. Bu yuzden esleme GORUNTU aninda yapiliyor:
 * gecmis de duzeliyor. Worker yeni satirlari zaten Ingilizce yaziyor;
 * esleme ikisini de ayni yere getiriyor.
 *
 * `dm:` satirlari BU KUMEDE YOK — onlar kisinin gonderdigi gercek DM
 * metnini tasiyor ("Chatgpt", "GTA"), etiket degil.
 */

/** Bilinen defter etiketleri -> panelde gosterilecek karsiligi. */
const ESLEME: Record<string, string> = {
  "(e-posta bekleniyor)": "(waiting for email)",
  "(e-posta alindi)": "(email received)",
  "(e-posta alındı)": "(email received)",
  "(takip istemi)": "(follow prompt)",
  "(button tap)": "(button tap)",
};

/**
 * Taninan bir defter etiketini Ingilizce karsiligina cevirir; taninmayan
 * her metin OLDUGU GIBI doner — gercek yorum metinlerine dokunulmamali.
 */
export function defterEtiketi(commentText: string | null | undefined): string {
  if (!commentText) return "";
  return ESLEME[commentText.trim()] ?? commentText;
}
