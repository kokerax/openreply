/**
 * /api/automations — the email-gate fields survive the round trip.
 *
 * The builder sends `""` for "use the built-in wording"; the DB must hold
 * `null`, not an empty string, or the worker would send a blank DM. And a
 * disabled gate must clear all three messages so re-enabling it later never
 * resurrects stale copy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    instagramAccount: { findFirst: vi.fn() },
    trackedLink: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: () => true,
}));

import { NextRequest } from "next/server";
import { PATCH, POST } from "../app/api/automations/route";

function jsonReq(url: string, body: unknown, method: "POST" | "PATCH") {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_CREATE = {
  name: "Lead magnet",
  dmMessage: "here you go",
  matchAnyPost: true,
  matchAnyWord: true,
};

function lastCreateData() {
  return mockPrisma.automation.create.mock.calls.at(-1)![0].data as Record<
    string,
    unknown
  >;
}

function lastUpdateData() {
  return mockPrisma.automation.update.mock.calls.at(-1)![0].data as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue({
    userId: "u_1",
    workspaceId: "ws_1",
    workspace: { id: "ws_1" },
    role: "OWNER",
  });
  mockPrisma.workspace.findUnique.mockResolvedValue({ id: "ws_1" });
  mockPrisma.instagramAccount.findFirst.mockResolvedValue({ id: "ig_1" });
  mockPrisma.automation.create.mockResolvedValue({ id: "a_1" });
  mockPrisma.automation.findFirst.mockResolvedValue({ id: "a_1", workspaceId: "ws_1" });
  mockPrisma.automation.update.mockResolvedValue({ id: "a_1" });
  mockPrisma.trackedLink.findMany.mockResolvedValue([]);
});

describe("POST /api/automations — email gate", () => {
  it("stores the three trimmed messages when the gate is on", async () => {
    const res = await POST(
      jsonReq("http://localhost/api/automations", {
        ...BASE_CREATE,
        emailGateEnabled: true,
        emailPromptMessage: "  E-posta adresin?  ",
        emailInvalidMessage: "Bunu okuyamadım",
        emailThanksMessage: "Teşekkürler!",
      }, "POST")
    );
    expect(res.status).toBe(201);
    const data = lastCreateData();
    expect(data.emailGateEnabled).toBe(true);
    expect(data.emailPromptMessage).toBe("E-posta adresin?");
    expect(data.emailInvalidMessage).toBe("Bunu okuyamadım");
    expect(data.emailThanksMessage).toBe("Teşekkürler!");
  });

  it('an empty box means "built-in wording" → null, not ""', async () => {
    await POST(
      jsonReq("http://localhost/api/automations", {
        ...BASE_CREATE,
        emailGateEnabled: true,
        emailPromptMessage: "   ",
        emailInvalidMessage: "",
        emailThanksMessage: null,
      }, "POST")
    );
    const data = lastCreateData();
    expect(data.emailGateEnabled).toBe(true);
    expect(data.emailPromptMessage).toBeNull();
    expect(data.emailInvalidMessage).toBeNull();
    expect(data.emailThanksMessage).toBeNull();
  });

  it("a disabled gate stores no messages even if some were sent", async () => {
    await POST(
      jsonReq("http://localhost/api/automations", {
        ...BASE_CREATE,
        emailGateEnabled: false,
        emailPromptMessage: "leftover copy",
      }, "POST")
    );
    const data = lastCreateData();
    expect(data.emailGateEnabled).toBe(false);
    expect(data.emailPromptMessage).toBeNull();
  });

  it("defaults to off when the field is absent (old clients keep working)", async () => {
    await POST(jsonReq("http://localhost/api/automations", BASE_CREATE, "POST"));
    expect(lastCreateData().emailGateEnabled).toBe(false);
  });
});

describe("PATCH /api/automations — email gate", () => {
  const url = "http://localhost/api/automations?id=a_1";

  it("turning the gate off clears all three messages", async () => {
    const res = await PATCH(
      jsonReq(url, { emailGateEnabled: false, emailPromptMessage: "keep me?" }, "PATCH")
    );
    expect(res.status).toBe(200);
    const data = lastUpdateData();
    expect(data.emailGateEnabled).toBe(false);
    expect(data.emailPromptMessage).toBeNull();
    expect(data.emailInvalidMessage).toBeNull();
    expect(data.emailThanksMessage).toBeNull();
  });

  it("with the gate on, empty strings become null and text is trimmed", async () => {
    await PATCH(
      jsonReq(url, {
        emailGateEnabled: true,
        emailPromptMessage: "  Adresin?  ",
        emailInvalidMessage: "",
      }, "PATCH")
    );
    const data = lastUpdateData();
    expect(data.emailPromptMessage).toBe("Adresin?");
    expect(data.emailInvalidMessage).toBeNull();
    // Not sent → left alone, so an unrelated PATCH never wipes it.
    expect(data.emailThanksMessage).toBeUndefined();
  });

  it("a PATCH that mentions no gate field touches none of them", async () => {
    await PATCH(jsonReq(url, { name: "Renamed" }, "PATCH"));
    const data = lastUpdateData();
    expect(data.name).toBe("Renamed");
    expect(data.emailGateEnabled).toBeUndefined();
    expect(data.emailPromptMessage).toBeUndefined();
    expect(data.emailInvalidMessage).toBeUndefined();
    expect(data.emailThanksMessage).toBeUndefined();
  });
});
