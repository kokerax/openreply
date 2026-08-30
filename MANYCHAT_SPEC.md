# ManyChat otomasyonlarının birebir kopyası — hedef spesifikasyon

Kaynak: ManyChat workspace `fb5511323` · Instagram hesabı **yapayzekakademisi**
Çıkarma tarihi: 2026-08-30 · Bu iki akış OpenReply'da birebir kurulacak.

Ortak hedef link: `https://www.yapayzekakademisi.com/ucretsiz-mini-egitim`
Ortak buton etiketi: `ARAÇLARA GİT`
Kişiselleştirme: `{{contact.first_name}}` → OpenReply karşılığı ile eşlenecek.

---

## 1) "Chatgpt" — yorum → DM  (LIVE · 139 run · CTR %93)

**Tetikleyici:** herhangi bir post veya reel'e yorum,
yorum şu kelimelerden birini içeriyor:
`chatgpt, chat, CHATGPT, Chatgpt, chatGPT, ChatGPT`

**Adım 1 — yorumun altına public yanıt:**
> DM'den gönderdim. Mesaj isteklerini kontrol etmeyi unutma.

**Adım 2 — açılış DM'i (opening DM), buton `YOLLA`:**
> 🙋‍♂️ Merhaba {{contact.first_name}} , yorumun için teşekkürler!
> Videolarda bahsettiğim yapay zeka araçları takipçilerime özeldir, almak için aşağıdaki butona tıkla

**Adım 3 — takip şartı (follow-gate), buton `Following`:**
> Linkten videolarda bahsettiğim yapay zeka araçlarına ulaşabilirsin:
> https://www.yapayzekakademisi.com/ucretsiz-mini-egitim

**Adım 4 — linkli DM, buton `ARAÇLARA GİT`:**
> Linkten videolarda bahsettiğim yapay zeka araçlarına ulaşabilirsin:
> https://www.yapayzekakademisi.com/ucretsiz-mini-egitim

**Adım 5 — tıklamayanlara takip DM'i:**
> Yapay zekaya meraklıysan bu linkten ulaşabilirsin ⬆️

Ölçülen metrik: 46 gönderim · 43 tıklama · CTR %93.

---

## 2) "Araç yazana link" — DM anahtar kelime  (LIVE · 30 run)

**Tetikleyici:** kullanıcı DM'de şu kelimelerden birini yazıyor:
`araç, Araç, ARAÇ, arac, Arac, ARAC`

**Adım 1 — takip şartı (follow-gate), buton `Following`:**
> Araçlar sadece takipçilerime özel. Takip ettikten sonra butona bas ve araçları al 🎉

**Adım 2 — linkli DM, buton `ARAÇLARA GİT`:**
> 🙋‍♂️ Merhaba {{contact.first_name}} , cevabın için teşekkürler!
> Linkten videolarda bahsettiğim yapay zeka araçlarına ulaşabilirsin:
> https://www.yapayzekakademisi.com/ucretsiz-mini-egitim

---

## Kopyalanmayacaklar

- **Instagram Default Reply** — STOPPED, zaten kapalı.
- **Untitled (DRAFT)** — 2026-08-30'da kurulan contact-silme denemesi, `Off`.
  Faturaya faydası olmadığı ölçüldüğü için canlıya alınmadı; ManyChat kapanınca
  birlikte gidecek. Bkz. [[manychat-overage-and-flow-builder]].

## OpenReply karşılıkları (kurulumda doğrulanacak)

| ManyChat özelliği | OpenReply karşılığı | Durum |
|---|---|---|
| yorum → private reply | `sendPrivateReply*` | kodda var |
| public comment reply | `sendCommentReply` | kodda var |
| follow-gate | `getUserFollowStatus` + `sendDirectMessageWithButton` | kodda var |
| linkli buton DM | `sendDirectMessageWithLinkButton` | kodda var |
| tıklamayana follow-up | `ProcessFollowUpJob` (gecikmeli) | kodda var |
| DM keyword tetikleyici | `ProcessMessageJob` + `dmTriggerEnabled` | kodda var |
| `{{contact.first_name}}` | şablon değişkeni — **eşleme doğrulanacak** | ⚠️ açık |

Kurulum sonrası her satır canlı testle doğrulanmalı: gerçek yorum at, DM'in
geldiğini ve linkin çalıştığını GÖR (kabı değil çıktıyı doğrula kuralı).
