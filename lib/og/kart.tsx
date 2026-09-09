/**
 * Paylasim karti (og:image) — tek uretici.
 *
 * Olcum (2026-09-09, canli): sekiz pazarlama sayfasinin HICBIRINDE og:image
 * yoktu. Link Slack/X/LinkedIn/WhatsApp'ta paylasildiginda gorselsiz, ciplak
 * bir satir olarak cikiyordu. Baslik/aciklama/h1/404 tarafi zaten temizdi;
 * eksik olan tek sey buydu.
 *
 * Her sayfa KENDI basligiyla bir kart aliyor: tek bir marka gorseli koymak
 * paylasilan dort ayri sayfayi ayirt edilemez yapardi.
 *
 * Yazi tipi BILEREK yuklenmedi: `next/og` kendi gomulu fontuyla ciziyor.
 * Disaridan font cekmek bu rotayi ag hatasina acik hale getirirdi ve kart
 * uretimi patlarsa sayfa og:image'siz kalir — yani duzeltmek istedigimiz
 * duruma geri doneriz.
 */
import { ImageResponse } from "next/og";

export const OG_BOYUT = { width: 1200, height: 630 } as const;
export const OG_TUR = "image/png";

/** Uzun basliklar karti tasirmasin; kirpma noktasi 78 karakterde. */
const BASLIK_TAVANI = 78;

export function ogKarti(etiket: string, baslik: string) {
  const metin =
    baslik.length > BASLIK_TAVANI ? `${baslik.slice(0, BASLIK_TAVANI - 1)}…` : baslik;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0f0f11",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "#f97316",
              display: "flex",
            }}
          />
          <div style={{ color: "#fafafa", fontSize: 34, fontWeight: 700 }}>
            OpenReply
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              color: "#fb923c",
              fontSize: 26,
              letterSpacing: 2,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            {etiket}
          </div>
          <div
            style={{
              color: "#fafafa",
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.15,
              display: "flex",
            }}
          >
            {metin}
          </div>
        </div>

        <div style={{ color: "#a1a1aa", fontSize: 26, display: "flex" }}>
          Instagram comment-to-DM automation
        </div>
      </div>
    ),
    OG_BOYUT
  );
}
