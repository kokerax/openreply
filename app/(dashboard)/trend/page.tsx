"use client";

/**
 * Trend Analysis (Trend Analizi)
 *
 * Half-year medians for views and engagement, plus engagement-per-view.
 * The point of separating those two: a drop in views with a steady
 * engagement rate means the algorithm stopped distributing the content —
 * not that the content got worse. Those two diagnoses lead to opposite
 * fixes, so the page states which one the data supports.
 *
 * Copy on this page is intentionally Turkish.
 */

import { useCallback, useEffect, useState } from "react";
import AccountSelect from "@/components/account-select";
import { IconRefresh } from "@/components/icons";
import { useToast } from "@/components/toast";
import type {
  TrendBucket,
  TrendResponse,
} from "@/app/api/instagram/trend/route";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("tr-TR");
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("tr-TR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "Europe/Istanbul" → "Istanbul", "America/New_York" → "New York". */
function zoneLabel(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Bucket table shared by cadence and caption-length. Every row carries its own
 * post count: a median over few posts is not worth acting on, and hiding the
 * count would let the reader treat all rows as equally solid.
 */
function BucketTable({
  rows,
  firstCol,
  caption,
}: {
  rows: TrendBucket[];
  firstCol: string;
  caption: string;
}) {
  return (
    <div className="table-wrap mt-3">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{firstCol}</th>
            <th scope="col" className="num">İçerik</th>
            <th scope="col" className="num">Medyan izlenme</th>
            <th scope="col" className="num">Medyan etkileşim</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="font-medium text-foreground">{r.label}</td>
              <td className="num">{r.posts}</td>
              <td className="num">{fmt(r.medianViews)}</td>
              <td className="num">{fmt(r.medianEngagement)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4 sm:p-6">
      <h2 className="section-title">{title}</h2>
      {lead && <p className="mt-1 text-sm text-muted">{lead}</p>}
      {children}
    </section>
  );
}

export default function TrendPage() {
  const toast = useToast();
  const [data, setData] = useState<TrendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // "" = let the API pick the default (most recently connected) account.
  const [selectedAccountId, setSelectedAccountId] = useState("");

  // `loading` starts true and is re-armed by the handlers below, not inside
  // the effect itself.
  const load = useCallback(async () => {
    const params = new URLSearchParams({ tz: browserTimeZone() });
    if (selectedAccountId) params.set("instagramAccountId", selectedAccountId);
    try {
      const res = await fetch(`/api/instagram/trend?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Analiz alınamadı");
      setData(json.data as TrendResponse);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analiz alınamadı";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
    // toast is stable (memoized in the provider)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  useEffect(() => {
    // load() only touches state after its first await; the lint rule cannot
    // see the async boundary. Same pattern as the inbox page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function reload() {
    setLoading(true);
    void load();
  }
  function handleAccountChange(next: string) {
    setLoading(true);
    setSelectedAccountId(next);
  }

  if (loading) {
    return (
      <div className="space-y-8" aria-busy="true">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Trend Analizi</h1>
          <p className="mt-1 text-sm text-muted">
            İçerikler ve metrikler çekiliyor — bu bir dakika sürebilir.
          </p>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel p-4 sm:p-6">
            <div className="h-4 w-40 rounded bg-surface-hover" />
            <div className="mt-4 h-10 rounded bg-surface-hover" />
            <div className="mt-2 h-10 rounded bg-surface-hover" />
            <div className="mt-2 h-10 rounded bg-surface-hover" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-8">
        <h1 className="text-lg font-semibold text-foreground">Trend Analizi</h1>
        <div className="panel p-8 text-center">
          <p className="text-sm text-error">{error ?? "Veri yok"}</p>
          <button
            type="button"
            onClick={reload}
            className="btn btn-secondary mt-4"
          >
            <IconRefresh size={16} />
            Tekrar dene
          </button>
        </div>
      </div>
    );
  }

  const accountSelect = data.accounts.length > 1 && (
    <AccountSelect
      accounts={data.accounts.map((a) => ({
        id: a.id,
        username: a.username,
        instagramId: a.id,
      }))}
      value={selectedAccountId || data.account.id}
      onChange={handleAccountChange}
      includeAll={false}
      label="Instagram hesabı"
    />
  );

  if (data.totalPosts === 0) {
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-lg font-semibold text-foreground">Trend Analizi</h1>
          {accountSelect}
        </div>
        <div className="panel p-8 text-center">
          <p className="text-sm text-foreground">
            @{data.account.username} hesabında henüz içerik yok.
          </p>
          <p className="mt-1 text-sm text-muted">
            İlk paylaşımlar geldiğinde dönemsel medyanlar burada görünür.
          </p>
          <button
            type="button"
            onClick={reload}
            className="btn btn-secondary btn-sm mt-3"
          >
            <IconRefresh size={14} />
            Yenile
          </button>
        </div>
      </div>
    );
  }

  const bestHour = [...data.hours].sort(
    (a, b) => b.medianEngagement - a.medianEngagement
  )[0];

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Trend Analizi</h1>
          <p className="mt-1 text-sm text-muted">
            @{data.account.username} · {data.totalPosts} içerik ·{" "}
            {data.withInsights} tanesinde izlenme verisi ·{" "}
            {shortDate(data.firstPost)} – {shortDate(data.lastPost)}
          </p>
        </div>
        {accountSelect}
      </header>

      {data.reachCollapsed && (
        <div className="panel border-warning/40 bg-warning-soft p-4">
          <p className="text-sm font-medium text-warning">
            Dağıtım sorunu: izlenme düştü, etkileşim oranı korundu.
          </p>
          <p className="mt-1 text-sm text-foreground">
            İçeriği gören kişiler hâlâ aynı oranda etkileşiyor — yani içerik
            kalitesi değil, Instagram&apos;ın dağıtımı daralmış. Bu durumda
            içeriği değiştirmek çözüm değildir.
          </p>
        </div>
      )}

      <Section
        title="Dönemsel medyan"
        lead="Ortalama değil medyan — tek bir viral içerik ortalamayı şişirir."
      >
        <div className="table-wrap mt-3">
          <table className="table min-w-[640px]">
            <caption className="sr-only">Yarıyıl bazında medyan metrikler</caption>
            <thead>
              <tr>
                <th scope="col">Dönem</th>
                <th scope="col" className="num">İçerik</th>
                <th scope="col" className="num">Medyan izlenme</th>
                <th scope="col" className="num">Medyan etkileşim</th>
                <th scope="col" className="num">Etkileşim/izlenme</th>
                <th scope="col" className="num">Medyan kaydetme</th>
              </tr>
            </thead>
            <tbody>
              {data.periods.map((p) => (
                <tr key={p.label}>
                  <td className="font-medium text-foreground">{p.label}</td>
                  <td className="num">{p.posts}</td>
                  <td className="num">{fmt(p.medianViews)}</td>
                  <td className="num">{fmt(p.medianEngagement)}</td>
                  <td className="num">
                    {p.engagementRate === null ? "—" : `%${p.engagementRate}`}
                  </td>
                  <td className="num">{fmt(p.medianSaved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={`Paylaşım saati (${zoneLabel(data.timeZone)})`}
        lead={
          bestHour
            ? `En iyi dilim ${bestHour.label} — medyan etkileşim ${fmt(bestHour.medianEngagement)}.`
            : undefined
        }
      >
        <div className="table-wrap mt-3">
          <table className="table">
            <caption className="sr-only">Paylaşım saatine göre medyan metrikler</caption>
            <thead>
              <tr>
                <th scope="col">Saat</th>
                <th scope="col" className="num">İçerik</th>
                <th scope="col" className="num">Medyan etkileşim</th>
                <th scope="col" className="num">Medyan izlenme</th>
              </tr>
            </thead>
            <tbody>
              {data.hours.map((h) => (
                <tr key={h.label}>
                  <td className="font-medium text-foreground">{h.label}</td>
                  <td className="num">{h.posts}</td>
                  <td className="num">{fmt(h.medianEngagement)}</td>
                  <td className="num">{fmt(h.medianViews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {data.last30 && (
        <Section title="Son 30 gün">
          <p className="mt-2 text-sm text-foreground">
            {data.last30.posts} içerik · medyan{" "}
            <strong>{fmt(data.last30.medianViews)}</strong> izlenme ·{" "}
            <strong>{fmt(data.last30.medianEngagement)}</strong> etkileşim.
            {data.last30.bestViews !== null && (
              <>
                {" "}
                En iyisi <strong>{fmt(data.last30.bestViews)}</strong> izlenme
                aldı — yani hesap hâlâ patlayabiliyor, düşen taban.
              </>
            )}
          </p>
        </Section>
      )}

      {data.cadence.length > 1 && (
        <Section
          title="Paylaşım sıklığı"
          lead="Bir önceki içerikten sonra geçen süreye göre. Aralık açıldıkça izlenme artıyorsa çok sık paylaşım kendi erişimini bölüyor demektir."
        >
          <BucketTable
            rows={data.cadence}
            firstCol="Önceki içerikten sonra"
            caption="Paylaşım aralığına göre medyan metrikler"
          />
        </Section>
      )}

      {data.captionLength.length > 1 && (
        <Section title="Açıklama uzunluğu">
          <BucketTable
            rows={data.captionLength}
            firstCol="Uzunluk"
            caption="Açıklama uzunluğuna göre medyan metrikler"
          />
        </Section>
      )}

      {data.cta.length > 1 && (
        <Section
          title="Yorum çağrısının etkisi"
          lead="Çağrının işi yorum getirmek, o yüzden ölçüt yorum/beğeni oranı — izlenme sayısı zaten dağıtımın işi."
        >
          <div className="table-wrap mt-3">
            <table className="table">
              <caption className="sr-only">Yorum çağrısı olan ve olmayan içerikler</caption>
              <thead>
                <tr>
                  <th scope="col">Açıklama</th>
                  <th scope="col" className="num">İçerik</th>
                  <th scope="col" className="num">Medyan yorum</th>
                  <th scope="col" className="num">Medyan beğeni</th>
                  <th scope="col" className="num">Yorum/beğeni</th>
                </tr>
              </thead>
              <tbody>
                {data.cta.map((c) => (
                  <tr key={c.label}>
                    <td className="font-medium text-foreground">{c.label}</td>
                    <td className="num">{c.posts}</td>
                    <td className="num">{fmt(c.medianComments)}</td>
                    <td className="num">{fmt(c.medianLikes)}</td>
                    <td className="num">%{c.commentPerLikePct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {data.unmeasured.length > 0 && (
        <Section title="Ölçülemeyenler">
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {data.unmeasured.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="En çok etkileşim alan içerikler">
        <ul className="mt-3 divide-y divide-border">
          {data.topPosts.map((p) => (
            <li key={p.timestamp} className="py-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-xs text-muted">{shortDate(p.timestamp)}</span>
                <span className="text-sm text-foreground">
                  {fmt(p.engagement)} etkileşim · {fmt(p.views)} izlenme
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-foreground">
                {p.permalink ? (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent hover:underline"
                  >
                    {p.caption?.slice(0, 120) ?? "(açıklama yok)"}
                  </a>
                ) : (
                  p.caption?.slice(0, 120) ?? "(açıklama yok)"
                )}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
