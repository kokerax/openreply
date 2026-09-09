import type { CampaignTemplate } from "@/lib/templates/campaign-templates";

interface TemplateVisualProps {
  template: CampaignTemplate;
  compact?: boolean;
}

/**
 * `accent` sekiz sablonun her birinde tanimliydi ama HICBIR YERDE
 * okunmuyordu: sekiz kart da ayni cyan tonundaydi, yani alan olu kodtu ve
 * kartlar birbirinden ayirt edilemiyordu. Ton burada tuketiliyor.
 *
 * Sinif adlari TAM YAZILI: Tailwind kaynagi statik tarar, `text-${x}-200`
 * gibi kurulan bir ad uretime hic girmez ve renk sessizce kaybolur.
 */
const TON: Record<
  CampaignTemplate["accent"],
  { etiket: string; cip: string; cizgi: string }
> = {
  cyan: {
    etiket: "text-cyan-200",
    cip: "border-cyan-200/30 bg-cyan-300/10 text-cyan-100",
    cizgi: "bg-cyan-300/60",
  },
  emerald: {
    etiket: "text-emerald-200",
    cip: "border-emerald-200/30 bg-emerald-300/10 text-emerald-100",
    cizgi: "bg-emerald-300/60",
  },
  rose: {
    etiket: "text-rose-200",
    cip: "border-rose-200/30 bg-rose-300/10 text-rose-100",
    cizgi: "bg-rose-300/60",
  },
  amber: {
    etiket: "text-amber-200",
    cip: "border-amber-200/30 bg-amber-300/10 text-amber-100",
    cizgi: "bg-amber-300/60",
  },
};

export default function TemplateVisual({
  template,
  compact = false,
}: TemplateVisualProps) {
  const ton = TON[template.accent];

  return (
    <div className="border border-border p-4">
      <div className="border border-border bg-surface p-4">
        {/* Ince ust cizgi: karti bir bakista ayirt eden tek isaret. */}
        <div className={`-mt-4 mb-4 h-0.5 w-full ${ton.cizgi}`} />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${ton.etiket}`}>
              Comment trigger
            </p>
            <p className="mt-1 text-sm font-bold text-white">
              {template.triggerExample}
            </p>
          </div>
          <span className={`border px-3 py-1 text-xs font-semibold ${ton.cip}`}>
            {template.category}
          </span>
        </div>

        <div className={`grid gap-3 pt-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <div className="border border-white/10 bg-white/[0.035] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Keywords
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {template.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className={`border px-2 py-1 text-xs font-bold ${ton.cip}`}
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
          <div className="border border-white/10 bg-white/[0.035] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Private reply
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-200">
              {template.privateReplyPreview}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
