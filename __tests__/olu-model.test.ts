/**
 * Olu model / yanlis vaat kapisi.
 *
 * `ProcessedComment` semada "paylasilan dedup kumesi: burada olan bir yorum
 * zaten kuyruklanmistir, iki yol da iki kez islemez" diye belgeleniyordu.
 * Bu vaat HIC GERCEKLESMEDI — hicbir kod tabloya yazmiyor. 2026-09
 * denetiminde webhook/tarama yarisi incelenirken bu yorum okunup "koruma
 * zaten var" sanildi; gercekte PENDING bir kayit iki kez gonderilebiliyordu.
 *
 * Not yazmak yetmez (ayni yorum zaten oradaydi ve yaniltti). Bu test iki
 * durumu birbirine BAGLIYOR: model kullanilmiyorsa yorumu "KULLANILMIYOR"
 * demeli; kullanilmaya baslanirsa test kirmizi yanar ve yorumu guncellemeye
 * zorlar.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const oku = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** Uretilen Prisma istemcisi haric, elle yazilmis kod. */
function elleYazilmisReferanslar(isim: string): string[] {
  const kokler = ["app", "lib", "worker", "components"];
  const bulunan: string[] = [];
  const gez = (dizin: string) => {
    if (!fs.existsSync(dizin)) return;
    for (const g of fs.readdirSync(dizin, { withFileTypes: true })) {
      const tam = path.join(dizin, g.name);
      // Uretilen istemci her modeli anar; sinyal degil gurultu.
      if (tam.includes("app/generated") || g.name === "node_modules") continue;
      if (g.isDirectory()) gez(tam);
      else if (/\.tsx?$/.test(g.name) && fs.readFileSync(tam, "utf8").includes(isim)) {
        bulunan.push(tam);
      }
    }
  };
  for (const k of kokler) gez(path.join(process.cwd(), k));
  return bulunan;
}

describe("ProcessedComment: vaat ile gercek ortusmeli", () => {
  const sema = oku("prisma/schema.prisma");

  it("model hala semada tanimli", () => {
    // Silinirse bu test dosyasi da gitmeli; o zaman kirmizi yanip hatirlatir.
    expect(sema).toContain("model ProcessedComment {");
  });

  it("KULLANILMIYORSA yorum bunu ACIKCA soylemeli", () => {
    const kullanan = elleYazilmisReferanslar("processedComment");
    const blokBasi = sema.indexOf("model ProcessedComment {");
    const yorum = sema.slice(Math.max(0, blokBasi - 1800), blokBasi);

    if (kullanan.length === 0) {
      expect(yorum).toContain("KULLANILMIYOR");
      // Eski yanlis vaat geri gelmemeli.
      expect(yorum).not.toContain("shared dedup set");
    } else {
      // Biri modeli kullanmaya basladi: yorum artik "kullanilmiyor" DEMEMELI.
      expect(
        `kullanan: ${kullanan.join(", ")} — sema yorumu guncellenmeli`
      ).toBe(yorum.includes("KULLANILMIYOR") ? "guncellenmedi" : `kullanan: ${kullanan.join(", ")} — sema yorumu guncellenmeli`);
    }
  });

  it("yorum GERCEK korumanin nerede oldugunu gosterir", () => {
    const blokBasi = sema.indexOf("model ProcessedComment {");
    const yorum = sema.slice(Math.max(0, blokBasi - 1800), blokBasi);

    // "Kullanilmiyor" demek yetmez; okuyan kisi korumayi nerede arayacagini
    // bilmeli, yoksa ikinci kez sifirdan kurmaya kalkar.
    expect(yorum).toContain("comment-reconciler");
    expect(yorum).toContain("@@unique");
  });

  it("job payload'indaki `source` alani da dogru belgelenmis", () => {
    // Bu yorum da "ProcessedComment dedup deposuna kaydedilir" diyordu.
    const src = oku("lib/queue/client.ts");
    const i = src.indexOf("source?: CommentSource;");
    expect(i).toBeGreaterThan(-1);
    const yorum = src.slice(Math.max(0, i - 400), i);
    expect(yorum).not.toMatch(/Recorded in the shared ProcessedComment/);
    expect(yorum).toContain("OKUNMUYOR");
  });
});
