import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { hedefeUtmEkle } from "@/lib/tracking/utm";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      slug: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
          name: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    },
  });

  // Hedefe UTM ekle: tiklamayi BIZ sayiyoruz ama kullanicinin kendi
  // analitiginde (GA4) bu trafik atifsiz geliyordu, yani "Instagram
  // otomasyonu siteme ne getirdi" sorusu cevapsizdi. Var olan parametre
  // ezilmez, fragment korunur, web disi sema oldugu gibi birakilir.
  const hedef = hedefeUtmEkle(trackedLink.destinationUrl, {
    kampanyaAdi: trackedLink.automation.name,
    slug: trackedLink.slug,
  });

  return NextResponse.redirect(hedef, { status: 302 });
}
