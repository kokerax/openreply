import { describe, it, expect, vi } from "vitest";

const deleteMany = vi.fn(async () => ({ count: 0 }));
const del = vi.fn(async () => {
  const e = new Error("No record was found for a delete.") as Error & { code: string };
  e.code = "P2025";
  throw e;
});
const findUnique = vi.fn(async () => null);
vi.mock("@/lib/db/client", () => ({ prisma: { session: { deleteMany, delete: del, findUnique }, operationalEvent: { create: vi.fn() } } }));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock("next-auth/providers/nodemailer", () => ({ default: () => ({}) }));
vi.mock("next-auth/providers/resend", () => ({ default: () => ({}) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({ deleteSession: (t: string) => del() }) }));

describe("dayanikliAdapter.deleteSession", () => {
  it("olmayan oturumu silmek hata firlatmaz (P2025 yutulur, deleteMany kullanilir)", async () => {
    const { dayanikliAdapter } = await import("@/lib/auth");
    const base = { deleteSession: (t: string) => del() };
    const a = dayanikliAdapter(base) as { deleteSession: (t: string) => Promise<void> };
    await expect(a.deleteSession("stale-cookie-token")).resolves.toBeNull();
    expect(deleteMany).toHaveBeenCalledWith({ where: { sessionToken: "stale-cookie-token" } });
    expect(del).not.toHaveBeenCalled();
  });
  it("sarmalanmamis adaptor ayni girdide P2025 ile patlar (kontrol cifti)", async () => {
    const base = { deleteSession: (t: string) => del() };
    await expect(base.deleteSession("stale-cookie-token")).rejects.toMatchObject({ code: "P2025" });
  });
});
