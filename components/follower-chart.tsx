"use client";

/**
 * Followers Over Time
 *
 * Line chart over stored daily snapshots. Deliberately separate from the
 * Overview stat tiles: those sum the selected posts, while this is an
 * account-level total that ignores the post range.
 *
 * Two series share one axis: points observed directly (solid, accent) and
 * points reconstructed from Instagram's follower_count deltas when the account
 * was first connected (dashed, muted, "estimated"). The dashed run extends to
 * the neighbouring measured point so the line reads as continuous.
 *
 * History depth is limited by what has been snapshotted — Instagram only serves
 * ~30 days of account insights, so earlier days exist only if this instance was
 * already running then.
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface FollowerChartPoint {
  date: string;
  followers: number;
  delta: number | null;
  /** Reconstructed from insight deltas rather than observed. */
  backfilled: boolean;
}

interface ChartRow extends FollowerChartPoint {
  measured: number | null;
  estimated: number | null;
}

// Theme tokens from globals.css; SVG resolves CSS custom properties, so the
// chart follows dark mode without a JS theme lookup.
const SERIES_COLOR = "var(--accent)";
const ESTIMATED_COLOR = "var(--muted)";
const GRID_COLOR = "var(--border)";
const AXIS_TEXT = "var(--muted)";
const DOT_RING = "var(--bg)";

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
}

/**
 * Split one history into the two chart series. Exported for tests.
 * A measured point next to a backfilled one is also placed on the estimated
 * series so the dashed segment joins the solid one instead of leaving a gap.
 */
export function splitFollowerSeries(data: FollowerChartPoint[]): ChartRow[] {
  return data.map((p, i) => {
    const prevBackfilled = i > 0 && data[i - 1].backfilled;
    const nextBackfilled = i < data.length - 1 && data[i + 1].backfilled;
    return {
      ...p,
      measured: p.backfilled ? null : p.followers,
      estimated:
        p.backfilled || prevBackfilled || nextBackfilled ? p.followers : null,
    };
  });
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="text-muted">
        {formatDay(point.date)}
        {point.backfilled ? " · estimated" : ""}
      </p>
      <p className="mt-1 font-semibold text-foreground">
        {point.followers.toLocaleString()} followers
      </p>
      {point.delta !== null && point.delta !== 0 && (
        <p className={point.delta > 0 ? "text-success" : "text-error"}>
          {formatSigned(point.delta)} that day
        </p>
      )}
    </div>
  );
}

export default function FollowerChart({
  data,
  followers,
}: {
  data: FollowerChartPoint[];
  followers: number | null;
}) {
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(() => splitFollowerSeries(data), [data]);
  const hasEstimated = rows.some((r) => r.backfilled);
  const estimatedCount = rows.filter((r) => r.backfilled).length;

  const current = followers ?? data.at(-1)?.followers ?? null;

  // Net change across the whole visible window, shown once in the header rather
  // than labelling every point.
  const net =
    data.length > 1 ? data[data.length - 1].followers - data[0].followers : null;

  return (
    <div className="panel p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="section-title">Followers over time</h2>
          <p className="mt-1 text-sm text-muted">
            {current === null
              ? "Follower count unavailable"
              : `${current.toLocaleString()} now`}
            {net !== null && (
              <>
                {" · "}
                <span className={net >= 0 ? "text-success" : "text-error"}>
                  {formatSigned(net)}
                </span>{" "}
                over {data.length} days
              </>
            )}
          </p>
        </div>
        {data.length > 1 && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="btn btn-secondary btn-sm"
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>

      {data.length < 2 ? (
        <div className="mt-6 rounded-md border border-border bg-surface p-6 text-center">
          <p className="text-sm text-foreground">Collecting follower history</p>
          <p className="mt-1 text-sm text-muted">
            {data.length === 0
              ? "No snapshots recorded yet."
              : "One day recorded so far."}{" "}
            A point is added daily — the chart appears once there are at least
            two.
          </p>
        </div>
      ) : showTable ? (
        <div className="table-wrap mt-4 max-h-72 overflow-y-auto">
          <table className="table">
            <caption className="sr-only">
              Daily follower totals, most recent first
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="num">
                  Followers
                </th>
                <th scope="col" className="num">
                  Change
                </th>
                {hasEstimated && <th scope="col">Source</th>}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((p) => (
                <tr key={p.date}>
                  <td className="text-foreground">{formatDay(p.date)}</td>
                  <td className="num text-muted">
                    {p.followers.toLocaleString()}
                  </td>
                  <td className="num text-muted">
                    {p.delta === null ? "—" : formatSigned(p.delta)}
                  </td>
                  {hasEstimated && (
                    <td>
                      {p.backfilled ? (
                        <span className="pill pill-muted">Estimated</span>
                      ) : (
                        <span className="pill pill-accent">Measured</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="mt-6 h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke={GRID_COLOR}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  stroke={GRID_COLOR}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={formatCompact}
                  tick={{ fill: AXIS_TEXT, fontSize: 12 }}
                  stroke={GRID_COLOR}
                  tickLine={false}
                  width={52}
                  // Followers rarely start near zero, so a zero baseline would
                  // flatten the line into a straight edge.
                  domain={["dataMin - 5", "dataMax + 5"]}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: GRID_COLOR, strokeWidth: 1 }}
                />
                {hasEstimated && (
                  <Line
                    type="monotone"
                    dataKey="estimated"
                    name="Estimated"
                    stroke={ESTIMATED_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: ESTIMATED_COLOR,
                      stroke: DOT_RING,
                      strokeWidth: 2,
                    }}
                    isAnimationActive={false}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="measured"
                  name="Measured"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: SERIES_COLOR,
                    stroke: DOT_RING,
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {hasEstimated && (
            <ul
              className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted"
              aria-label="Legend"
            >
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-5 rounded bg-accent"
                />
                Measured
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0 w-5 border-t-2 border-dashed border-muted"
                />
                Estimated ({estimatedCount} day{estimatedCount === 1 ? "" : "s"}{" "}
                reconstructed from Instagram&apos;s daily change data)
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
