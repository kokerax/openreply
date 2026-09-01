"use client";

/**
 * Top bar: page title, mobile menu, theme toggle, connection status.
 * Titles resolve by longest matching prefix so nested routes get a name.
 */

import { usePathname } from "next/navigation";
import { IconMenu } from "@/components/icons";
import { ThemeToggle } from "@/components/theme";

const pageTitles: Array<[prefix: string, title: string]> = [
  ["/dashboard", "Dashboard"],
  ["/overview", "Overview"],
  ["/trend", "Trend"],
  ["/inbox", "Inbox"],
  ["/campaigns/new", "New Campaign"],
  ["/campaigns/import", "Import Campaigns"],
  ["/campaigns/", "Campaign"],
  ["/campaigns", "Campaigns"],
  ["/automations/new", "New Campaign"],
  ["/automations", "Campaigns"],
  ["/logs", "DM Logs"],
  ["/settings", "Settings"],
  ["/diagnostics", "Diagnostics"],
];

export function titleFor(pathname: string): string {
  if (/^\/campaigns\/[^/]+\/edit\/?$/.test(pathname)) return "Edit Campaign";
  let best: [string, string] | null = null;
  for (const entry of pageTitles) {
    const [prefix] = entry;
    const hit = pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/") || pathname === prefix.replace(/\/$/, "");
    if (hit && (!best || prefix.length > best[0].length)) best = entry;
  }
  return best?.[1] ?? "Dashboard";
}

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({ onMenuClick, instagramUsername, instagramAccountCount }: TopBarProps) {
  const pathname = usePathname();
  const title = titleFor(pathname);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:px-8 border-b border-border bg-background"
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="btn btn-secondary btn-icon lg:hidden"
          aria-label="Open navigation"
        >
          <IconMenu />
        </button>
        <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {instagramAccountCount > 0 ? (
          <p className="truncate text-sm text-muted">
            {instagramAccountCount > 1
              ? `${instagramAccountCount} accounts`
              : `@${instagramUsername}`}
          </p>
        ) : (
          <a href="/api/instagram/connect" className="btn btn-primary">
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect Instagram</span>
          </a>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
