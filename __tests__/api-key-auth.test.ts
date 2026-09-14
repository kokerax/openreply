import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAuth, mockEnsure } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
  mockAuth: {
    getCurrentUserId: vi.fn(),
    getCurrentWorkspaceId: vi.fn(),
  },
  mockEnsure: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/workspace", () => ({ ensureWorkspaceForUser: mockEnsure }));

import { apiAnahtariGecerli } from "../lib/api-key-auth";
import {
  getRequestWorkspaceContext,
  getRequestWorkspaceId,
} from "../lib/workspace-access";
import { POST as bulkPost } from "../app/api/automations/bulk/route";
import { NextRequest } from "next/server";

const KEY = "dogru-anahtar-0123456789abcdef";
const EMAIL = "sahip@example.com";

function istek(authorization?: string, body?: unknown) {
  return new NextRequest("https://x.test/api/automations/bulk", {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

const uyelik = (role: string) => ({
  workspaceId: "ws_1",
  role,
  workspace: { id: "ws_1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENREPLY_API_KEY", KEY);
  vi.stubEnv("OPENREPLY_API_USER_EMAIL", EMAIL);
  mockAuth.getCurrentUserId.mockResolvedValue(null);
  mockAuth.getCurrentWorkspaceId.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiAnahtariGecerli", () => {
  it("dogru Bearer anahtari kabul eder", () => {
    expect(apiAnahtariGecerli(`Bearer ${KEY}`)).toBe(true);
  });

  it.each([
    ["baslik yok", null],
    ["yanlis anahtar", "Bearer yanlis"],
    ["bos anahtar", "Bearer "],
    ["Bearer oneki yok", KEY],
    ["onek kucuk harf", `bearer ${KEY}`],
    ["anahtarin oneki", `Bearer ${KEY.slice(0, -1)}`],
  ])("reddeder: %s", (_ad, baslik) => {
    expect(apiAnahtariGecerli(baslik)).toBe(false);
  });

  it("OPENREPLY_API_KEY yoksa dogru gorunen baslik bile reddedilir", () => {
    vi.stubEnv("OPENREPLY_API_KEY", "");
    expect(apiAnahtariGecerli(`Bearer ${KEY}`)).toBe(false);
    expect(apiAnahtariGecerli("Bearer ")).toBe(false);
  });

  it("OPENREPLY_API_KEY tanimsizken herhangi bir Bearer degeri reddedilir (patlamaz)", () => {
    vi.stubEnv("OPENREPLY_API_KEY", undefined);
    expect(apiAnahtariGecerli("Bearer herhangi-bir-deger")).toBe(false);
  });

  it("OPENREPLY_API_USER_EMAIL yoksa yol kapali", () => {
    vi.stubEnv("OPENREPLY_API_USER_EMAIL", "");
    expect(apiAnahtariGecerli(`Bearer ${KEY}`)).toBe(false);
  });
});

describe("getRequestWorkspaceContext", () => {
  it("gecerli anahtar -> anahtar kullanicisinin ilk uyeligi, oturuma bakmaz", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "user_1" });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(uyelik("OWNER"));

    const ctx = await getRequestWorkspaceContext(istek(`Bearer ${KEY}`));

    expect(ctx).toEqual({
      userId: "user_1",
      workspaceId: "ws_1",
      workspace: { id: "ws_1" },
      role: "OWNER",
    });
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: EMAIL, mode: "insensitive" } },
      select: { id: true },
    });
    expect(mockAuth.getCurrentUserId).not.toHaveBeenCalled();
  });

  it("gecerli anahtar + bilinmeyen e-posta -> null ve workspace OLUSTURULMAZ", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    expect(await getRequestWorkspaceContext(istek(`Bearer ${KEY}`))).toBeNull();
    expect(await getRequestWorkspaceId(istek(`Bearer ${KEY}`))).toBeNull();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("gecerli anahtar + uyeligi olmayan kullanici -> null, workspace olusturulmaz", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "user_1" });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

    expect(await getRequestWorkspaceContext(istek(`Bearer ${KEY}`))).toBeNull();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("yanlis anahtar -> oturum yoluna duser, DB'de kullanici aranmaz", async () => {
    expect(await getRequestWorkspaceContext(istek("Bearer yanlis"))).toBeNull();
    expect(mockAuth.getCurrentUserId).toHaveBeenCalled();
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("anahtarsiz getRequestWorkspaceId -> mevcut getCurrentWorkspaceId (oturum yolu degismedi)", async () => {
    mockAuth.getCurrentWorkspaceId.mockResolvedValue("ws_oturum");
    expect(await getRequestWorkspaceId(istek())).toBe("ws_oturum");
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("route kablolamasi (POST /api/automations/bulk)", () => {
  it("anahtarsiz ve oturumsuz -> 401", async () => {
    const res = await bulkPost(istek(undefined, { ids: ["a"], action: "pause" }));
    expect(res.status).toBe(401);
  });

  it("yanlis anahtar -> 401", async () => {
    const res = await bulkPost(istek("Bearer yanlis", { ids: ["a"], action: "pause" }));
    expect(res.status).toBe(401);
  });

  it("gecerli anahtar ama MEMBER rolu -> 403 (rol denetimi anahtarla atlanmaz)", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "user_1" });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(uyelik("MEMBER"));
    const res = await bulkPost(istek(`Bearer ${KEY}`, { ids: ["a"], action: "pause" }));
    expect(res.status).toBe(403);
  });
});
