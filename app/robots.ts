/**
 * robots.txt
 *
 * Yoktu; Next varsayilan olarak bir sey uretmiyor, yani crawler'a ne sitemap
 * adresi ne de kapali alan bilgisi gidiyordu.
 *
 * `disallow` listesi indekslenmemesi GEREKENLER: panel (oturum arkasinda ama
 * yine de taranmasin), API, Auth uclari, ve **paylasilan rapor baglantilari**
 * (`/reports/*` gizli slug ile korunuyor; aramada cikmasi o gizliligi bozar).
 */
import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const taban = getBaseUrl().replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/campaigns",
        "/automations",
        "/logs",
        "/leads",
        "/inbox",
        "/overview",
        "/settings",
        "/diagnostics",
        "/trend",
        "/reports/",
        "/invite/",
        "/verify-request",
        // Kisa link yonlendiricisi: taranmasi tiklama sayaclarini sisirir.
        "/r/",
      ],
    },
    sitemap: `${taban}/sitemap.xml`,
    host: taban,
  };
}
