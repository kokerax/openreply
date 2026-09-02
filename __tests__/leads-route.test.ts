/**
 * /api/leads — workspace scoping, date range, search (both directions),
 * campaign filter, sort allowlist, 5000 cap.
 *
 * Two layers of assertion, because each catches a different class of bug:
 *
 * 1. Structural — the exact `where` handed to Prisma. Catches a filter that is
 *    built wrong or dropped entirely.
 * 2. Behavioural — a tiny in-memory evaluator interprets that `where` over a
 *    fixture set, so "search finds the matching row" and "search finds nothing
 *    for a non-matching term" are both asserted on rows, not on shapes. This is
 *    a stand-in for Prisma, not Prisma: it covers the operators this route
 *    actually emits (`gte`/`lt`, `contains` + `mode: "insensitive"`, `OR`,
 *    scalar equality) and throws on anything else so a new operator can never
 *    be silently ignored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    lead: { findMany: vi.fn(), count: vi.fn() },
  },
  mockWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));

import { NextRequest } from "next/server";
import { GET } from "../app/api/leads/route";

function req(query = "") {
  return new NextRequest(`http://localhost/api/leads${query}`);
}

function lastFindManyArgs() {
  const calls = mockPrisma.lead.findMany.mock.calls;
  return calls[calls.length - 1][0] as {
    where: Record<string, unknown>;
    orderBy: unknown;
    skip: number;
    take: number;
  };
}

/* ------------------------- in-memory where evaluator ---------------------- */

interface Row {
  id: string;
  workspaceId: string;
  automationId: string;
  email: string;
  username: string | null;
  createdAt: Date;
}

const ROWS: Row[] = [
  {
    id: "l1",
    workspaceId: "ws_1",
    automationId: "a_1",
    // Both fields are mixed-case on purpose: a case-SENSITIVE `contains`
    // would match neither, so the behavioural search test really depends on
    // `mode: "insensitive"` rather than passing by accident on one field.
    email: "Ayse@Example.com",
    username: "Ayse_K",
    createdAt: new Date("2026-08-02T10:00:00.000Z"),
  },
  {
    id: "l2",
    workspaceId: "ws_1",
    automationId: "a_2",
    email: "bob@other.com",
    username: "bobby",
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
  },
  {
    id: "l3",
    workspaceId: "ws_2", // another workspace — must never be returned
    automationId: "a_9",
    email: "ayse@leak.test",
    username: "ayse_other",
    createdAt: new Date("2026-08-02T11:00:00.000Z"),
  },
  {
    id: "l4",
    workspaceId: "ws_1",
    automationId: "a_1",
    email: "old@example.com",
    username: "eski",
    createdAt: new Date("2026-01-01T10:00:00.000Z"), // outside an August range
  },
];

type Clause = Record<string, unknown>;

function matchField(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== "object") {
    return value === condition;
  }
  const cond = condition as Record<string, unknown>;
  for (const [op, operand] of Object.entries(cond)) {
    switch (op) {
      case "mode":
        break; // handled together with `contains`
      case "gte":
        if (!((value as Date) >= (operand as Date))) return false;
        break;
      case "lt":
        if (!((value as Date) < (operand as Date))) return false;
        break;
      case "contains": {
        if (value === null || value === undefined) return false;
        const insensitive = cond.mode === "insensitive";
        const hay = insensitive ? String(value).toLowerCase() : String(value);
        const needle = insensitive
          ? String(operand).toLowerCase()
          : String(operand);
        if (!hay.includes(needle)) return false;
        break;
      }
      default:
        // A new operator must fail loudly, not filter nothing.
        throw new Error(`Unsupported operator in test evaluator: ${op}`);
    }
  }
  return true;
}

function matches(row: Row, where: Clause): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === "OR") {
      const branches = condition as Clause[];
      if (!branches.some((branch) => matches(row, branch))) return false;
      continue;
    }
    if (!matchField((row as unknown as Record<string, unknown>)[key], condition)) {
      return false;
    }
  }
  return true;
}

function installRowEvaluator() {
  mockPrisma.lead.findMany.mockImplementation(
    ({ where, take, skip = 0 }: { where: Clause; take: number; skip?: number }) =>
      Promise.resolve(ROWS.filter((r) => matches(r, where)).slice(skip, skip + take))
  );
  mockPrisma.lead.count.mockImplementation(({ where }: { where: Clause }) =>
    Promise.resolve(ROWS.filter((r) => matches(r, where)).length)
  );
}

async function idsFor(query: string): Promise<string[]> {
  installRowEvaluator();
  const res = await GET(req(query));
  const body = await res.json();
  expect(res.status).toBe(200);
  return (body.data.leads as Row[]).map((l) => l.id);
}

/* --------------------------------- tests --------------------------------- */

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockPrisma.lead.findMany.mockResolvedValue([]);
  mockPrisma.lead.count.mockResolvedValue(0);
});

describe("GET /api/leads", () => {
  it("401 without a workspace, and no query is issued", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(mockPrisma.lead.findMany).not.toHaveBeenCalled();
  });

  it("defaults: 30-day range, createdAt desc, page 1 × 50", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    const args = lastFindManyArgs();
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.where.workspaceId).toBe("ws_1");
    expect(args.where.createdAt).toBeDefined();
    expect(body.data.range.days).toBe(30);
    expect(body.data.sort).toEqual({ col: "createdAt", dir: "desc" });
    expect(body.data.pagination.totalPages).toBe(1);
  });

  it("scopes every query to the session workspace", async () => {
    mockWorkspaceId.mockResolvedValue("ws_1");
    // l3 belongs to ws_2 and shares the "ayse" term — it must not come back.
    const ids = await idsFor("?from=2026-08-01&to=2026-08-31&search=ayse");
    expect(ids).toEqual(["l1"]);
    expect(lastFindManyArgs().where.workspaceId).toBe("ws_1");
    expect(mockPrisma.lead.count).toHaveBeenCalledWith({
      where: lastFindManyArgs().where,
    });
  });

  it("date range: from/to become gte/lt, and rows outside it drop out", async () => {
    const ids = await idsFor("?from=2026-08-01&to=2026-08-03");
    expect(lastFindManyArgs().where.createdAt).toEqual({
      gte: new Date("2026-08-01T00:00:00.000Z"),
      lt: new Date("2026-08-04T00:00:00.000Z"),
    });
    // l4 (January) is excluded; l3 is another workspace.
    expect(ids).toEqual(["l1", "l2"]);

    // The `to` day is inclusive: a narrower range keeps only the earlier row.
    expect(await idsFor("?from=2026-08-01&to=2026-08-02")).toEqual(["l1"]);
  });

  it("search matches email or username, case-insensitively", async () => {
    await GET(req("?search=%20Ayse%20"));
    expect(lastFindManyArgs().where.OR).toEqual([
      { email: { contains: "Ayse", mode: "insensitive" } },
      { username: { contains: "Ayse", mode: "insensitive" } },
    ]);
  });

  it("search both directions: a matching term returns rows, a non-matching term returns none", async () => {
    const range = "?from=2026-08-01&to=2026-08-31";
    // Matching, on email (stored as "Ayse@Example.com" — different case).
    expect(await idsFor(`${range}&search=ayse`)).toEqual(["l1"]);
    // Matching, on username only.
    expect(await idsFor(`${range}&search=bobby`)).toEqual(["l2"]);
    // Non-matching term returns zero rows — the filter really excludes.
    expect(await idsFor(`${range}&search=zzz-nobody`)).toEqual([]);

    const res = await GET(req(`${range}&search=zzz-nobody`));
    expect((await res.json()).data.pagination.total).toBe(0);
  });

  it("blank search adds no OR clause (and does not hide rows)", async () => {
    const ids = await idsFor("?from=2026-08-01&to=2026-08-31&search=%20%20");
    expect(lastFindManyArgs().where.OR).toBeUndefined();
    expect(ids).toEqual(["l1", "l2"]);
  });

  it("campaign filter: an id narrows, 'all' does not", async () => {
    expect(
      await idsFor("?from=2026-08-01&to=2026-08-31&automationId=a_1")
    ).toEqual(["l1"]);
    expect(lastFindManyArgs().where.automationId).toBe("a_1");

    expect(
      await idsFor("?from=2026-08-01&to=2026-08-31&automationId=all")
    ).toEqual(["l1", "l2"]);
    expect(lastFindManyArgs().where.automationId).toBeUndefined();
  });

  it("caps limit at 5000, floors at 1, falls back to 50 on nonsense", async () => {
    await GET(req("?limit=999999"));
    expect(lastFindManyArgs().take).toBe(5000);

    await GET(req("?limit=5000"));
    expect(lastFindManyArgs().take).toBe(5000);

    await GET(req("?limit=-5"));
    expect(lastFindManyArgs().take).toBe(1);

    // 0 is not a usable page size → default, not a zero-row query.
    await GET(req("?limit=0"));
    expect(lastFindManyArgs().take).toBe(50);

    await GET(req("?limit=abc&page=xyz"));
    expect(lastFindManyArgs().take).toBe(50);
    expect(lastFindManyArgs().skip).toBe(0);
  });

  it("sort allowlist maps known columns and rejects unknown ones", async () => {
    await GET(req("?sort=email&dir=asc"));
    expect(lastFindManyArgs().orderBy).toEqual({ email: "asc" });

    await GET(req("?sort=username&dir=desc"));
    expect(lastFindManyArgs().orderBy).toEqual({ username: "desc" });

    await GET(req("?sort=campaign&dir=asc"));
    expect(lastFindManyArgs().orderBy).toEqual({ automation: { name: "asc" } });

    const res = await GET(req("?sort=evil&dir=sideways"));
    expect(lastFindManyArgs().orderBy).toEqual({ createdAt: "desc" });
    expect((await res.json()).data.sort).toEqual({ col: "createdAt", dir: "desc" });
  });

  it("pagination: page 3 × 50 skips 100", async () => {
    mockPrisma.lead.count.mockResolvedValue(230);
    const res = await GET(req("?page=3"));
    expect(lastFindManyArgs().skip).toBe(100);
    expect((await res.json()).data.pagination).toEqual({
      page: 3,
      limit: 50,
      total: 230,
      totalPages: 5,
    });
  });

  it("500 with the message when the DB throws", async () => {
    mockPrisma.lead.findMany.mockRejectedValue(new Error("boom"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "boom" });
  });
});
