"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconActivity,
  IconChart,
  IconHome,
  IconInbox,
  IconList,
  IconMail,
  IconMegaphone,
  IconSettings,
  IconTrend,
} from "@/components/icons";

export const EMBEDDED_NAV_ITEMS = [
  { label: "Genel", href: "/dashboard", Icon: IconHome },
  { label: "Gelen kutusu", href: "/inbox", Icon: IconInbox },
  { label: "Otomasyonlar", href: "/campaigns", Icon: IconMegaphone },
  { label: "Gönderimler", href: "/logs", Icon: IconList },
  { label: "Kişiler", href: "/leads", Icon: IconMail },
  { label: "Özet", href: "/overview", Icon: IconChart },
  { label: "Eğilim", href: "/trend", Icon: IconTrend },
  { label: "Tanılama", href: "/diagnostics", Icon: IconActivity },
  { label: "Ayarlar", href: "/settings", Icon: IconSettings },
] as const;

export type EmbeddedNavItem = (typeof EMBEDDED_NAV_ITEMS)[number];

export default function PanelEmbeddedNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Panel navigation"
      className="border-b border-border bg-background px-2 py-2"
    >
      <div className="mx-auto flex min-h-[42px] gap-2 overflow-x-auto min-w-0">
        {EMBEDDED_NAV_ITEMS.map(({ label, href, Icon }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex min-w-max flex-none items-center justify-center gap-1 rounded-md px-2.5 py-2.5 whitespace-nowrap text-xs sm:py-1.5 sm:flex-col ${
                isActive
                  ? "bg-surface-hover text-foreground"
                  : "text-muted hover:text-foreground hover:bg-surface-hover"
              }`}
            >
              <Icon size={14} className={isActive ? "text-accent" : ""} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
