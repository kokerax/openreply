"use client";

/**
 * Column-sort for client-side tables.
 * `const { sorted, sort, toggle } = useSort(rows, "createdAt", "desc")`
 * then `<SortableTh sort={sort} col="createdAt" onToggle={toggle}>Date</SortableTh>`.
 */

import { useMemo, useState } from "react";
import { IconChevronDown, IconChevronUp } from "@/components/icons";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  col: K;
  dir: SortDir;
}

export function useSort<T, K extends string>(
  rows: T[],
  initialCol: K,
  initialDir: SortDir = "desc",
  accessor?: (row: T, col: K) => unknown
) {
  const [sort, setSort] = useState<SortState<K>>({ col: initialCol, dir: initialDir });

  const sorted = useMemo(() => {
    const get = accessor ?? ((r: T, c: K) => (r as Record<string, unknown>)[c]);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a, sort.col);
      const vb = get(b, sort.col);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort, accessor]);

  const toggle = (col: K) =>
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }
    );

  return { sorted, sort, toggle };
}

interface ThProps<K extends string> {
  col: K;
  sort: SortState<K>;
  onToggle: (col: K) => void;
  children: React.ReactNode;
  className?: string;
}

export function SortableTh<K extends string>({ col, sort, onToggle, children, className = "" }: ThProps<K>) {
  const active = sort.col === col;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={className}
    >
      <button
        type="button"
        onClick={() => onToggle(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {children}
        {active ? (sort.dir === "asc" ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />) : null}
      </button>
    </th>
  );
}
