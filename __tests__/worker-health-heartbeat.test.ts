import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workerHealth: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  KALP_ATISI_KIRMIZI_MS,
  kalpAtisiBayatMi,
  recordWorkerHeartbeat,
} from "@/lib/ops/worker-health";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("kalpAtisiBayatMi", () => {
  it("is 3 minutes", () => {
    expect(KALP_ATISI_KIRMIZI_MS).toBe(180_000);
  });

  it("is stale with no heartbeat at all", () => {
    expect(kalpAtisiBayatMi(null)).toBe(true);
  });

  it("is fresh just under the threshold and stale just over it", () => {
    expect(kalpAtisiBayatMi(180_000 - 1)).toBe(false);
    expect(kalpAtisiBayatMi(180_000)).toBe(false);
    expect(kalpAtisiBayatMi(180_000 + 1)).toBe(true);
  });
});

describe("recordWorkerHeartbeat region", () => {
  it("stores VERCEL_REGION when the caller gives no region", async () => {
    vi.stubEnv("VERCEL_REGION", "fra1");
    mockPrisma.workerHealth.upsert.mockResolvedValue({});
    await recordWorkerHeartbeat({ pid: 1, hostname: "h" });
    const payload = mockPrisma.workerHealth.upsert.mock.calls[0][0].create.payload;
    expect(payload.region).toBe("fra1");
    expect(payload.status).toBe("running");
  });

  it("omits the region field entirely when none is known", async () => {
    vi.stubEnv("VERCEL_REGION", "");
    mockPrisma.workerHealth.upsert.mockResolvedValue({});
    await recordWorkerHeartbeat({ pid: 1 });
    const payload = mockPrisma.workerHealth.upsert.mock.calls[0][0].create.payload;
    expect("region" in payload).toBe(false);
  });
});
