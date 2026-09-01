import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  nextShareState,
  shareUpdateSchema,
  updateReportShare,
} from "../app/api/automations/[id]/share/share-logic";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nextShareState", () => {
  it("keeps an existing slug so the public URL stays stable across toggles", () => {
    const gen = vi.fn(() => "fresh");
    expect(nextShareState("keep-me", false, gen)).toEqual({
      reportShareSlug: "keep-me",
      reportShareEnabled: false,
    });
    expect(nextShareState("keep-me", true, gen)).toEqual({
      reportShareSlug: "keep-me",
      reportShareEnabled: true,
    });
    expect(gen).not.toHaveBeenCalled();
  });

  it("generates a slug when the campaign has none", () => {
    const gen = vi.fn(() => "fresh");
    expect(nextShareState(null, true, gen)).toEqual({
      reportShareSlug: "fresh",
      reportShareEnabled: true,
    });
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("default generator yields a url-safe non-empty slug", () => {
    const state = nextShareState(null, true);
    expect(state.reportShareSlug).toMatch(/^[A-Za-z0-9_-]{8,}$/);
  });
});

describe("shareUpdateSchema", () => {
  it("requires a boolean `enabled`", () => {
    expect(shareUpdateSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(shareUpdateSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(shareUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateReportShare", () => {
  it("returns null when the campaign is not in the workspace", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(null);
    expect(await updateReportShare("ws_1", "auto_1", true)).toBeNull();
    expect(mockPrisma.automation.findFirst).toHaveBeenCalledWith({
      where: { id: "auto_1", workspaceId: "ws_1" },
      select: { id: true, reportShareSlug: true },
    });
    expect(mockPrisma.automation.update).not.toHaveBeenCalled();
  });

  it("creates a slug when missing and returns the public URL", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      id: "auto_1",
      reportShareSlug: null,
    });
    mockPrisma.automation.update.mockImplementation(
      async (args: { data: { reportShareSlug: string; reportShareEnabled: boolean } }) => ({
        reportShareSlug: args.data.reportShareSlug,
        reportShareEnabled: args.data.reportShareEnabled,
      })
    );

    const result = await updateReportShare("ws_1", "auto_1", true);

    expect(result).not.toBeNull();
    expect(result!.reportShareEnabled).toBe(true);
    expect(result!.reportShareSlug).toBeTruthy();
    expect(result!.reportUrl).toBe(
      `${(process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")}/reports/${result!.reportShareSlug}`
    );
  });

  it("disabling keeps the slug and flips the flag", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      id: "auto_1",
      reportShareSlug: "abc123",
    });
    mockPrisma.automation.update.mockResolvedValue({
      reportShareSlug: "abc123",
      reportShareEnabled: false,
    });

    const result = await updateReportShare("ws_1", "auto_1", false);

    expect(mockPrisma.automation.update).toHaveBeenCalledWith({
      where: { id: "auto_1" },
      data: { reportShareSlug: "abc123", reportShareEnabled: false },
      select: { reportShareSlug: true, reportShareEnabled: true },
    });
    expect(result).toEqual({
      reportShareEnabled: false,
      reportShareSlug: "abc123",
      reportUrl: expect.stringContaining("/reports/abc123"),
    });
  });
});
