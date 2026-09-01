/**
 * Server side of the date range picker. `from`/`to` arrive as YYYY-MM-DD and
 * mean inclusive local days; we widen to [from 00:00, to+1 00:00) in UTC-ish
 * terms so a query can use `gte from, lt toExclusive`.
 *
 * Defaults to the last 30 days. Rejects ranges over 366 days and nonsense.
 */

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 366;

export interface ResolvedRange {
  from: Date;
  toExclusive: Date;
  days: number;
  fromKey: string;
  toKey: string;
}

function parseDay(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function key(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveDateRange(
  params: URLSearchParams,
  defaultDays = 30
): ResolvedRange {
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  let to = parseDay(params.get("to")) ?? todayUtc;
  let from =
    parseDay(params.get("from")) ?? new Date(to.getTime() - (defaultDays - 1) * DAY);
  if (from > to) [from, to] = [to, from];
  if ((to.getTime() - from.getTime()) / DAY > MAX_DAYS) {
    from = new Date(to.getTime() - (MAX_DAYS - 1) * DAY);
  }
  const toExclusive = new Date(to.getTime() + DAY);
  return {
    from,
    toExclusive,
    days: Math.round((toExclusive.getTime() - from.getTime()) / DAY),
    fromKey: key(from),
    toKey: key(to),
  };
}

/** Every day key in the range, in order — for zero-filling a series. */
export function dayKeys(range: ResolvedRange): string[] {
  const out: string[] = [];
  for (let t = range.from.getTime(); t < range.toExclusive.getTime(); t += DAY) {
    out.push(key(new Date(t)));
  }
  return out;
}
