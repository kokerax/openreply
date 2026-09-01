/**
 * Bulk campaign actions (pause / resume / delete). Kept out of route.ts so it
 * can be unit-tested — Next only allows HTTP handlers as route exports.
 *
 * Every id must belong to the caller's workspace; one foreign id rejects the
 * whole request rather than silently acting on the subset. Delete goes through
 * `deleteMany` on the same table the single-delete route uses, so the DB-level
 * `onDelete: Cascade` on DmLog / TrackedLink / LinkClick applies identically.
 */
import { z } from "zod";
import { prisma } from "@/lib/db/client";

export const bulkActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["pause", "resume", "delete"]),
});

export type BulkAction = z.infer<typeof bulkActionSchema>["action"];

export type BulkResult =
  | { ok: true; action: BulkAction; count: number }
  | { ok: false; status: 404; error: string; missing: string[] };

export async function runBulkAction(
  workspaceId: string,
  ids: string[],
  action: BulkAction
): Promise<BulkResult> {
  const unique = Array.from(new Set(ids));

  const owned = await prisma.automation.findMany({
    where: { id: { in: unique }, workspaceId },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((a) => a.id));
  const missing = unique.filter((id) => !ownedIds.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 404,
      error: `${missing.length} campaign${missing.length === 1 ? "" : "s"} not found in this workspace`,
      missing,
    };
  }

  const where = { id: { in: unique }, workspaceId };

  if (action === "delete") {
    const result = await prisma.automation.deleteMany({ where });
    return { ok: true, action, count: result.count };
  }

  const result = await prisma.automation.updateMany({
    where,
    data: { isActive: action === "resume" },
  });
  return { ok: true, action, count: result.count };
}
