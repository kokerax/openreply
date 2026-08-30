"use client";

/**
 * Trend Analysis
 *
 * Half-year medians for views and engagement, plus engagement-per-view.
 * The point of separating those two: a drop in views with a steady
 * engagement rate means the algorithm stopped distributing the content —
 * not that the content got worse. Those two diagnoses lead to opposite
 * fixes, so the page states which one the data supports.
 */

import { useEffect, useState } from "react";
import type { TrendResponse } from "@/app/api/instagram/trend/route";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("tr-TR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function TrendPage() {
  const [data, setData] = useState<TrendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/instagram/trend");
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) setError(json.error ?? "Analiz alınamadı");
        else setData(json.data as TrendResponse);
      } catch {
        if (!cancelled) setError("Analiz alınamadı");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Trend Analizi</h1>
        <p className="mt-4 text-sm text-gray-500">
          İçerikler ve metrikler çekiliyor — bu bir dakika sürebilir.
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold">Trend Analizi</h1>
        <p className="mt-4 text-sm text-red-600">{error ?? "Veri yok"}</p>
      </div>
    );
  }

  const bestHour = [...data.hours].sort(
    (a, b) => b.medianEngagement - a.medianEngagement
  )[0];

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Trend Analizi</h1>
        <p className="mt-1 text-sm text-gray-500">
          {data.totalPosts} içerik · {data.withInsights} tanesinde izlenme verisi ·{" "}
          {shortDate(data.firstPost)} – {shortDate(data.lastPost)}
        </p>
      </header>

      {data.reachCollapsed && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">
            Dağıtım sorunu: izlenme düştü, etkileşim oranı korundu.
          </p>
          <p className="mt-1 text-sm text-amber-800">
            İçeriği gören kişiler hâlâ aynı oranda etkileşiyor — yani içerik
            kalitesi değil, Instagram&apos;ın dağıtımı daralmış. Bu durumda
            içeriği değiştirmek çözüm değildir.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-lg font-medium">Dönemsel medyan</h2>
        <p className="mt-1 text-sm text-gray-500">
          Ortalama değil medyan — tek bir viral içerik ortalamayı şişirir.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-4">Dönem</th>
                <th className="py-2 pr-4 text-right">İçerik</th>
                <th className="py-2 pr-4 text-right">Medyan izlenme</th>
                <th className="py-2 pr-4 text-right">Medyan etkileşim</th>
                <th className="py-2 pr-4 text-right">Etkileşim/izlenme</th>
                <th className="py-2 text-right">Medyan kaydetme</th>
              </tr>
            </thead>
            <tbody>
              {data.periods.map((p) => (
                <tr key={p.label} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{p.label}</td>
                  <td className="py-2 pr-4 text-right">{p.posts}</td>
                  <td className="py-2 pr-4 text-right">{fmt(p.medianViews)}</td>
                  <td className="py-2 pr-4 text-right">
                    {fmt(p.medianEngagement)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {p.engagementRate === null ? "—" : `%${p.engagementRate}`}
                  </td>
                  <td className="py-2 text-right">{fmt(p.medianSaved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Paylaşım saati (İstanbul)</h2>
        {bestHour && (
          <p className="mt-1 text-sm text-gray-500">
            En iyi dilim <strong>{bestHour.label}</strong> — medyan etkileşim{" "}
            {fmt(bestHour.medianEngagement)}.
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-4">Saat</th>
                <th className="py-2 pr-4 text-right">İçerik</th>
                <th className="py-2 pr-4 text-right">Medyan etkileşim</th>
                <th className="py-2 text-right">Medyan izlenme</th>
              </tr>
            </thead>
            <tbody>
              {data.hours.map((h) => (
                <tr key={h.label} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{h.label}</td>
                  <td className="py-2 pr-4 text-right">{h.posts}</td>
                  <td className="py-2 pr-4 text-right">
                    {fmt(h.medianEngagement)}
                  </td>
                  <td className="py-2 text-right">{fmt(h.medianViews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">En çok etkileşim alan içerikler</h2>
        <ul className="mt-3 space-y-2">
          {data.topPosts.map((p) => (
            <li key={p.timestamp} className="border-b pb-2 last:border-0">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-gray-500">
                  {shortDate(p.timestamp)}
                </span>
                <span className="text-sm">
                  {fmt(p.engagement)} etkileşim · {fmt(p.views)} izlenme
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm">
                {p.permalink ? (
                  <a
                    href={p.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
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
      </section>
    </div>
  );
}
