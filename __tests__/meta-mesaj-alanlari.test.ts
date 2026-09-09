/**
 * Meta'dan ISTENEN alanlar — onizleme yalnizca istenirse calisir.
 *
 * `mesajOnizlemesi` butonlu mesajin metnini `attachments` icinden okuyor ve
 * kendi testleriyle kanitli. Ama alan listesinden `attachments` dusurulurse
 * Meta o alani HIC gondermez, onizleme yine bos doner ve panel "(no text)"
 * davranisina sessizce geri doner. Mutasyon testi bu bosluğu ortaya cikardi:
 * alanlar silindiginde 558 testin HICBIRI kirmizi olmadi.
 *
 * Bu test kaynak metni aramiyor — istemciyi CAGIRIP kurdugu URL'i okuyor,
 * cunku kaynakta kelime arayan assert kendi mutasyonunu gecebiliyor
 * (import satiri, tip tanimi, yorum satiri da eslesir).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getConversationMessages,
  getConversations,
} from "@/lib/meta/client";

/** Cagriyi yakalayip istenen URL'i dondurur. */
async function istenenUrl(cagir: () => Promise<unknown>): Promise<URL> {
  let yakalanan = "";
  vi.stubGlobal("fetch", async (url: string) => {
    yakalanan = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [], messages: { data: [] } }),
    };
  });
  await cagir();
  return new URL(yakalanan);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Onizlemenin okudugu her alan burada istenmeli. */
const ZORUNLU = ["message", "attachments", "shares", "story"];

/**
 * Alan adini TAM token olarak arar.
 *
 * `toContain("message")` KORDU: alan listesi `messages.limit(1){...}` ile
 * basliyor ve "messages" zaten "message" iceriyor — `message` alanini
 * silsen bile assert yesil kaliyordu. Token siniri `{`, `,` ya da dize
 * basi/sonu olmali.
 */
function alanDeseni(alan: string): RegExp {
  return new RegExp(`(^|[{,])${alan}([,}]|$)`);
}

describe("konusma listesi", () => {
  it("onizlemenin okudugu TUM alanlari ister", async () => {
    const u = await istenenUrl(() => getConversations("tok", "ig_1"));
    const fields = u.searchParams.get("fields") ?? "";

    for (const alan of ZORUNLU) {
      expect(fields, `"${alan}" alani istenmiyor`).toMatch(alanDeseni(alan));
    }
  });

  it("KARSI YON: alakasiz bir alani istemiyor", async () => {
    // Assert'in kendisi anlamli olsun: her metni gecirmediğini gosterir.
    const u = await istenenUrl(() => getConversations("tok", "ig_1"));
    expect(u.searchParams.get("fields") ?? "").not.toContain("uydurma_alan");
  });
});

describe("sohbet govdesi", () => {
  it("onizlemenin okudugu TUM alanlari ister", async () => {
    const u = await istenenUrl(() => getConversationMessages("tok", "konusma_1"));
    const fields = u.searchParams.get("fields") ?? "";

    for (const alan of ZORUNLU) {
      expect(fields, `"${alan}" alani istenmiyor`).toMatch(alanDeseni(alan));
    }
  });
});
