import Link from "next/link";
import PublicSiteHeader from "@/components/public-site-header";

export interface SeoPageSection {
  title: string;
  body: string;
}

export interface SeoPageConfig {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: string;
  secondaryCta?: string;
  bullets: string[];
  sections: SeoPageSection[];
  comparisonTitle: string;
  comparisons: Array<{
    label: string;
    ours: string;
    other: string;
  }>;
  templateLinks: Array<{
    label: string;
    href: string;
  }>;
  faqs: SeoPageSection[];
}

/**
 * FAQPage yapisal verisi.
 *
 * Sayfalarda 8 gercek soru-cevap vardi ama duz `<h3>/<p>` olarak basiliyordu;
 * arama motoru bunlarin SSS oldugunu bilmiyordu. JSON-LD ile ayni icerik
 * sonuc sayfasinda acilir soru-cevap olarak cikabilir. Yeni metin
 * UYDURULMUYOR — birebir ayni config kullaniliyor, yoksa isaretleme ile
 * gorunen icerik ayrisir ve bu Google'in aciktan yasakladigi seydir.
 */
function faqYapisalVeri(config: SeoPageConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: config.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.title,
      acceptedAnswer: { "@type": "Answer", text: faq.body },
    })),
  };
}

export default function SeoPageShell({ config }: { config: SeoPageConfig }) {
  return (
    // `dark` BILEREK sabit: bu pazarlama sayfalarinin icindeki 147 sinif
    // (text-white, bg-zinc-950, border-white/10 ...) tema belirteci degil sabit
    // koyu renk. Kapsayici `bg-background` ise temaya gore degisiyordu, yani
    // acik temadaki ziyaretcide beyaz zemin uzerine beyaz baslik ciziliyordu.
    // Kabugu koyuya kilitlemek ikisini ayni palete getirir.
    <main className="dark min-h-screen bg-background text-foreground">
      {config.faqs.length > 0 && (
        <script
          type="application/ld+json"
          // İçerik kendi config'imizden geliyor, kullanıcı girdisi değil.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(faqYapisalVeri(config)),
          }}
        />
      )}
      <PublicSiteHeader />

      <section className="border-b border-white/10 bg-zinc-950/70">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div>
            <p className="text-sm font-bold uppercase text-cyan-200">
              {config.eyebrow}
            </p>
            <h1 className="mt-4 text-5xl font-black leading-tight text-white sm:text-6xl">
              {config.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
              {config.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-cyan-300 px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-cyan-200"
              >
                {config.primaryCta}
              </Link>
              <Link
                href="/templates"
                className="inline-flex items-center justify-center border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-bold text-white transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                {config.secondaryCta ?? "Browse templates"}
              </Link>
            </div>
          </div>

          <div className="border border-white/10 bg-white/[0.035] p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
              Campaign OS checklist
            </p>
            <ul className="mt-5 space-y-4">
              {config.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-sm leading-6 text-zinc-300">
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {config.sections.map((section) => (
            <article key={section.title} className="border border-white/10 bg-white/[0.035] p-6">
              <h2 className="text-2xl font-black text-white">{section.title}</h2>
              <p className="mt-4 text-sm leading-7 text-zinc-400">{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.025] py-16">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-black text-white">{config.comparisonTitle}</h2>
          <div className="mt-8 overflow-hidden border border-white/10">
            <div className="grid grid-cols-[0.8fr_1fr_1fr] border-b border-white/10 bg-zinc-950 text-xs font-bold uppercase tracking-wide text-zinc-500">
              <div className="p-4">Need</div>
              <div className="p-4 text-cyan-100">OpenReply</div>
              <div className="p-4">Generic automation</div>
            </div>
            {config.comparisons.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-1 border-b border-white/10 last:border-0 md:grid-cols-[0.8fr_1fr_1fr]"
              >
                <div className="bg-zinc-950/50 p-4 text-sm font-semibold text-white">
                  {item.label}
                </div>
                <div className="p-4 text-sm leading-6 text-zinc-300">
                  {item.ours}
                </div>
                <div className="p-4 text-sm leading-6 text-zinc-500">
                  {item.other}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <p className="text-sm font-bold uppercase text-emerald-200">
            Start from a template
          </p>
          <h2 className="mt-3 text-4xl font-black text-white">
            Launch a campaign faster than building a chatbot flow
          </h2>
          <p className="mt-5 text-sm leading-7 text-zinc-400">
            Use a campaign template, connect the right Instagram account, pick
            the post, and ship a measurable comment-to-DM loop.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {config.templateLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border border-white/10 bg-white/[0.035] p-5 text-sm font-semibold text-white transition hover:border-cyan-200/30 hover:bg-cyan-300/10"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-white/10 bg-zinc-950/70 py-16">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-sm font-bold uppercase text-cyan-200">FAQ</p>
            <h2 className="mt-3 text-4xl font-black text-white">
              Search questions, answered clearly
            </h2>
          </div>
          <div className="grid gap-3">
            {config.faqs.map((faq) => (
              <article key={faq.title} className="border border-white/10 bg-white/[0.035] p-5">
                <h3 className="text-lg font-bold text-white">{faq.title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{faq.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-6 lg:px-8">
        <div className="border border-cyan-200/20 bg-cyan-300/10 p-8 text-center">
          <h2 className="text-4xl font-black text-white">
            Turn the next high-intent comment into a private reply
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-300">
            OpenReply is built for Instagram professional accounts, official
            Meta private replies, and campaign reporting teams can show clients.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex items-center justify-center bg-cyan-300 px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-cyan-200"
          >
            Start free
          </Link>
        </div>
      </section>
    </main>
  );
}

