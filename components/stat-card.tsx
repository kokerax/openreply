/**
 * Stat Card — label, value, optional hint line and trend.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  /** Small secondary line, e.g. "42 today". */
  hint?: string;
  /** Delta text, e.g. "+12%" — colored by trendUp. */
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ label, value, hint, trend, trendUp }: StatCardProps) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {(hint || trend) && (
        <p className="mt-1 flex items-center gap-2 text-xs text-muted">
          {trend && (
            <span className={trendUp ? "text-success" : "text-error"}>
              {trendUp ? "▲" : "▼"} {trend}
            </span>
          )}
          {hint && <span>{hint}</span>}
        </p>
      )}
    </div>
  );
}
