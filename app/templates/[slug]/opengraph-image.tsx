import { ogKarti, OG_BOYUT, OG_TUR } from "@/lib/og/kart";
import {
  CAMPAIGN_TEMPLATES,
  getCampaignTemplate,
} from "@/lib/templates/campaign-templates";

export const alt = "Instagram comment-to-DM template - OpenReply";
export const size = OG_BOYUT;
export const contentType = OG_TUR;

/**
 * Sekiz sablonun her biri kendi adiyla paylasilsin. Ust segmentin karti
 * miras alinsaydi sekiz ayri sablon linki ayni gorseli tasirdi.
 */
export function generateStaticParams() {
  return CAMPAIGN_TEMPLATES.map((t) => ({ slug: t.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const template = getCampaignTemplate(slug);
  // Bilinmeyen slug'da karti ureten yol COKMEMELI: sayfa 404 verse bile
  // paylasim karti istegi ayri bir rota ve 500 donmesi log'u kirletir.
  return ogKarti("Template", template?.title ?? "Campaign template");
}
