import CampaignBuilder from "@/components/campaign-builder";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";

/**
 * `?template=<slug>` burada okunur.
 *
 * Zincir su ana kadar UC ADIM gidip dorduncude oluyordu: SEO sablon sayfasi
 * `/login?template=<slug>` linki uretiyor, `/login` bunu okuyup callbackUrl'i
 * `/campaigns/new?template=<slug>` yapiyor, ama bu sayfa searchParams'i hic
 * almiyordu — secim giristen sonra sessizce dusuyordu. lib/seo-pages.ts bu
 * akisin calistigini pazarlama metninde ACIKCA iddia ediyor.
 */
export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  // Bilinmeyen slug sessizce yok sayilir: kullanici bos bir builder gorur,
  // hata sayfasi degil.
  const secilen = getCampaignTemplate(template);

  return <CampaignBuilder mode="new" template={secilen ?? undefined} />;
}
