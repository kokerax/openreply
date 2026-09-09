/**
 * sitemap.xml
 *
 * Bu dosya yokken 13 public sayfanin 12'si arama motorlari icin **kesfedilemezdi**:
 * ana sayfadaki tek ic link `/login`, pazarlama sayfalarina projede hicbir yerden
 * link verilmiyordu. Sayfalar yayindaydi, kimse bulamiyordu.
 *
 * Yalnizca indekslenmesini istedigimiz sayfalar burada. Oturum/kisiye ozel
 * rotalar (`/login`, `/verify-request`, `/invite/[token]`, `/reports/[shareSlug]`)
 * bilerek disarida: paylasilan rapor baglantisi gizli olmali, sitemap'e koymak
 * onu aramaya acar.
 */
import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/env";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates/campaign-templates";

/** Icerigi elle degistigimiz icin sabit; her deploy'da "bugun" yazmak
 *  crawler'a yalan soyler ve tarama butcesini bosa harcar. */
const SON_GUNCELLEME = new Date("2026-09-09");

export default function sitemap(): MetadataRoute.Sitemap {
  const taban = getBaseUrl().replace(/\/$/, "");

  const sayfalar: { yol: string; oncelik: number; siklik: "weekly" | "monthly" }[] = [
    { yol: "", oncelik: 1, siklik: "weekly" },
    { yol: "/manychat-alternative", oncelik: 0.9, siklik: "monthly" },
    { yol: "/comment-link-automation", oncelik: 0.9, siklik: "monthly" },
    { yol: "/instagram-dm-automation-agencies", oncelik: 0.9, siklik: "monthly" },
    { yol: "/instagram-comment-to-dm-templates", oncelik: 0.9, siklik: "monthly" },
    { yol: "/templates", oncelik: 0.8, siklik: "monthly" },
    { yol: "/privacy", oncelik: 0.3, siklik: "monthly" },
    { yol: "/terms", oncelik: 0.3, siklik: "monthly" },
    { yol: "/data-deletion", oncelik: 0.3, siklik: "monthly" },
  ];

  const sablonlar = CAMPAIGN_TEMPLATES.map((t) => ({
    yol: `/templates/${t.slug}`,
    oncelik: 0.7,
    siklik: "monthly" as const,
  }));

  return [...sayfalar, ...sablonlar].map((s) => ({
    url: `${taban}${s.yol}`,
    lastModified: SON_GUNCELLEME,
    changeFrequency: s.siklik,
    priority: s.oncelik,
  }));
}
