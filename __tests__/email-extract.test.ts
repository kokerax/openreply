import { describe, it, expect } from "vitest";
import { extractEmail, epostaDenemesiMi } from "@/lib/utils/email-extract";

describe("extractEmail — kabul", () => {
  it.each([
    ["ali@example.com", "ali@example.com"],
    ["Adresim: Ali.Koker+gta@Gmail.COM", "ali.koker+gta@gmail.com"],
    ["ali@example.com.", "ali@example.com"],
    ["teşekkürler ali@example.com, bekliyorum!", "ali@example.com"],
    ["mail: a_b-c.d@alt.alan.co.uk gönderdim", "a_b-c.d@alt.alan.co.uk"],
    ["ali (at) example (dot) com", "ali@example.com"],
    ["ali＠example.com", "ali@example.com"],
    ["\nali@example.com\n", "ali@example.com"],
  ])("%s → %s", (girdi, beklenen) => expect(extractEmail(girdi)).toBe(beklenen));
});

describe("extractEmail — red (kontrol çifti)", () => {
  it.each([
    ["gta"], ["prompt yollar mısın"], ["@aliankara"], ["bana da at @kokerax"],
    ["ali@"], ["@example.com"], ["ali@ornek"], ["ali@x.1"], ["ali..koker@x.com"],
    [""], [null], [undefined],
  ])("%s → null", (girdi) => expect(extractEmail(girdi as string)).toBeNull());
});

describe("epostaDenemesiMi", () => {
  it("bozuk adres denemesini ayırt eder", () => {
    expect(epostaDenemesiMi("ali@ornek")).toBe(true);
    expect(epostaDenemesiMi("gta")).toBe(false);
    expect(epostaDenemesiMi("ali@example.com")).toBe(false);
  });
});
