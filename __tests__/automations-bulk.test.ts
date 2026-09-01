import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automation: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { bulkActionSchema, runBulkAction } from "../app/api/automations/bulk/bulk";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automation.updateMany.mockResolvedValue({ count: 2 });
  mockPrisma.automation.deleteMany.mockResolvedValue({ count: 2 });
});

describe("bulkActionSchema", () => {
  it("accepts the three actions and rejects others", () => {
    expect(bulkActionSchema.safeParse({ ids: ["a"], action: "pause" }).success).toBe(true);
    expect(bulkActionSchema.safeParse({ ids: ["a"], action: "resume" }).success).toBe(true);
    expect(bulkActionSchema.safeParse({ ids: ["a"], action: "delete" }).success).toBe(true);
    expect(bulkActionSchema.safeParse({ ids: ["a"], action: "archive" }).success).toBe(false);
    expect(bulkActionSchema.safeParse({ ids: [], action: "pause" }).success).toBe(false);
    expect(bulkActionSchema.safeParse({ ids: [""], action: "pause" }).success).toBe(false);
  });
});

describe("runBulkAction", () => {
  it("pauses only ids owned by the workspace", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    const result = await runBulkAction("ws_1", ["a", "b"], "pause");

    expect(result).toEqual({ ok: true, action: "pause", count: 2 });
    expect(mockPrisma.automation.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, workspaceId: "ws_1" },
      select: { id: true },
    });
    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, workspaceId: "ws_1" },
      data: { isActive: false },
    });
    expect(mockPrisma.automation.deleteMany).not.toHaveBeenCalled();
  });

  it("resume sets isActive true", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ id: "a" }]);
    mockPrisma.automation.updateMany.mockResolvedValue({ count: 1 });

    const result = await runBulkAction("ws_1", ["a"], "resume");

    expect(result).toEqual({ ok: true, action: "resume", count: 1 });
    expect(mockPrisma.automation.updateMany.mock.calls[0][0].data).toEqual({
      isActive: true,
    });
  });

  it("delete uses deleteMany scoped to the workspace (DB cascade applies)", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    const result = await runBulkAction("ws_1", ["a", "b", "a"], "delete");

    expect(result).toEqual({ ok: true, action: "delete", count: 2 });
    expect(mockPrisma.automation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, workspaceId: "ws_1" },
    });
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the whole batch when any id is foreign to the workspace", async () => {
    // "b" belongs to another workspace, so the scoped lookup never returns it.
    mockPrisma.automation.findMany.mockResolvedValue([{ id: "a" }]);

    const result = await runBulkAction("ws_1", ["a", "b"], "delete");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(404);
    expect(result.missing).toEqual(["b"]);
    // Nothing is touched — not even the id we do own.
    expect(mockPrisma.automation.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });
});
