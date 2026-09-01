"use client";

/**
 * Sidebar navigation: icon + label, active state, workspace footer.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconActivity,
  IconChart,
  IconHome,
  IconInbox,
  IconList,
  IconMegaphone,
  IconSettings,
  IconTrend,
} from "@/components/icons";

const navItems = [
  { label: "Dashboard", href: "/dashboard", Icon: IconHome },
  { label: "Campaigns", href: "/campaigns", Icon: IconMegaphone },
  { label: "Inbox", href: "/inbox", Icon: IconInbox },
  { label: "DM Logs", href: "/logs", Icon: IconList },
  { label: "Overview", href: "/overview", Icon: IconChart },
  { label: "Trend", href: "/trend", Icon: IconTrend },
  { label: "Diagnostics", href: "/diagnostics", Icon: IconActivity },
  { label: "Settings", href: "/settings", Icon: IconSettings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({ isOpen, onClose, workspaceName }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Primary"
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div
          className="px-6 py-5 border-b border-border"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <Link href="/dashboard" className="text-base font-semibold">
            OpenReply
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map(({ label, href, Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-surface-hover text-foreground font-medium"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                }`}
              >
                <Icon size={17} className={isActive ? "text-accent" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">Self-hosted</p>
        </div>
      </aside>
    </>
  );
}
