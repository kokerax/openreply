/**
 * Report-sharing toggle. A campaign keeps one stable share slug for life:
 * turning sharing off hides the public page (`getCampaignReportBySlug`
 * filters on reportShareEnabled) without invalidating the URL, so turning it
 * back on restores the same link.
 */
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";

export const shareUpdateSchema = z.object({ enabled: z.boolean() });

/** Pure: the fields to persist for the requested state. */
export function nextShareState(
  existingSlug: string | null,
  enabled: boolean,
  generate: () => string = generateReportShareSlug
) {
  return {
    reportShareSlug: existingSlug ?? generate(),
    reportShareEnabled: enabled,
  };
}

export async function updateReportShare(
  workspaceId: string,
  automationId: string,
  enabled: boolean
) {
  const existing = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId },
    select: { id: true, reportShareSlug: true },
  });
  if (!existing) return null;

  const updated = await prisma.automation.update({
    where: { id: existing.id },
    data: nextShareState(existing.reportShareSlug, enabled),
    select: { reportShareSlug: true, reportShareEnabled: true },
  });

  return {
    reportShareEnabled: updated.reportShareEnabled,
    reportShareSlug: updated.reportShareSlug,
    reportUrl: updated.reportShareSlug
      ? buildReportUrl(updated.reportShareSlug)
      : null,
  };
}
