"use client";

/**
 * Date range: presets + custom from/to. Values are YYYY-MM-DD in the
 * viewer's local calendar; the API interprets them as inclusive days.
 */

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
] as const;

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function rangeForDays(days: number): DateRange {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

export function rangeThisMonth(): DateRange {
  const now = new Date();
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

export function rangeToParams(range: DateRange, params = new URLSearchParams()) {
  params.set("from", range.from);
  params.set("to", range.to);
  return params;
}

interface Props {
  value: DateRange;
  onChange: (r: DateRange) => void;
  className?: string;
}

export default function DateRangePicker({ value, onChange, className = "" }: Props) {
  const activePreset = RANGE_PRESETS.find((p) => {
    const r = rangeForDays(p.days);
    return r.from === value.from && r.to === value.to;
  })?.key;
  const isMonth =
    !activePreset &&
    rangeThisMonth().from === value.from &&
    rangeThisMonth().to === value.to;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div
        role="group"
        aria-label="Date range"
        className="flex overflow-hidden rounded-md border border-border"
      >
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={activePreset === p.key}
            onClick={() => onChange(rangeForDays(p.days))}
            className={`px-2.5 py-1.5 text-xs font-medium ${
              activePreset === p.key
                ? "bg-surface-hover text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isMonth}
          onClick={() => onChange(rangeThisMonth())}
          className={`px-2.5 py-1.5 text-xs font-medium ${
            isMonth ? "bg-surface-hover text-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          This month
        </button>
      </div>
      <label className="flex items-center gap-1 text-xs text-muted">
        <span className="sr-only">From</span>
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          className="input input-sm w-auto"
        />
      </label>
      <span className="text-xs text-muted">–</span>
      <label className="flex items-center gap-1 text-xs text-muted">
        <span className="sr-only">To</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          max={iso(new Date())}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          className="input input-sm w-auto"
        />
      </label>
    </div>
  );
}
