import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { seoSagligiOl } from "@/lib/ops/seo-saglik";

export const runtime = "nodejs";

/**
 * GET /api/admin/seo-health
 *
 * Canli public sayfalari cekip SEO kurulumunu dogrular. Oturum arkasinda:
 * cikti sitenin yapisini anlatiyor ve her istek dort sayfa cekiyor, oturumsuz
 * acik birakmak gereksiz yuk ve gereksiz ifsa olurdu.
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const data = await seoSagligiOl();
  return NextResponse.json({ success: true, data });
}
