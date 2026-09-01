import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  isCalismaAlaninaAitMi,
  isiGetir,
  isiSil,
  isiYenidenKuyrukla,
  type YonetimIsi,
} from "@/lib/queue/pg-queue";

export const runtime = "nodejs";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Sahiplik: is, calisma alaninin Instagram hesaplarindan birine ait olmali.
 * Baskasinin isi icin 404 (varligini bile soylememek icin 403 degil).
 */
type SahiplikSonucu = { hata: NextResponse; job?: never } | { hata?: never; job: YonetimIsi };

async function sahipliIsiBul(id: string): Promise<SahiplikSonucu> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return { hata: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageWorkspace(ctx.role)) {
    return { hata: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) };
  }
  const [job, hesaplar] = await Promise.all([
    isiGetir(id),
    prisma.instagramAccount.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true } }),
  ]);
  if (!job || !isCalismaAlaninaAitMi(job.data, hesaplar.map((h) => h.id))) {
    return { hata: NextResponse.json({ success: false, error: "Job not found." }, { status: 404 }) };
  }
  return { job };
}

// POST /api/admin/queue/[id] → retry (PENDING, runAt now, attempts 0)
export async function POST(_request: NextRequest, { params }: RouteProps): Promise<NextResponse> {
  const { id } = await params;
  const sonuc = await sahipliIsiBul(id);
  if (sonuc.hata) return sonuc.hata;

  try {
    await isiYenidenKuyrukla(id, new Date());
    return NextResponse.json({ success: true, data: { id, status: "PENDING" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// DELETE /api/admin/queue/[id] → purge
export async function DELETE(_request: NextRequest, { params }: RouteProps): Promise<NextResponse> {
  const { id } = await params;
  const sonuc = await sahipliIsiBul(id);
  if (sonuc.hata) return sonuc.hata;

  try {
    await isiSil(id);
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purge failed.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
