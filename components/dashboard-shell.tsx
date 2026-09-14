"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/sidebar";
import PanelEmbeddedNav from "@/components/panel-embedded-nav";
import TopBar from "@/components/top-bar";
import { type Theme, applyTheme } from "@/components/theme";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export const PANEL_PARENT_ORIGIN = "https://panel.dijitalpilot.com";

export type DashboardPanelMessage = {
  type: "dp-panel:theme";
  theme: Theme;
};

function isPanelThemeMessage(data: unknown): data is DashboardPanelMessage {
  if (!data || typeof data !== "object") return false;
  const raw = data as Partial<DashboardPanelMessage>;
  return raw.type === "dp-panel:theme" && (raw.theme === "light" || raw.theme === "dark");
}

export function extractPanelTheme(data: unknown): Theme | null {
  return isPanelThemeMessage(data) ? data.theme : null;
}

export function isValidPanelThemeEvent(
  event: MessageEvent,
  origin = PANEL_PARENT_ORIGIN
): boolean {
  return event.origin === origin && event.source === window.parent && isPanelThemeMessage(event.data);
}

function DashboardShellEmbedded({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const workspaceText = instagramAccountCount > 0
    ? instagramAccountCount > 1
      ? `${instagramAccountCount} Instagram hesabı`
      : instagramUsername
        ? `@${instagramUsername}`
        : "Instagram hesabı yok"
    : "Instagram hesabı yok";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="truncate text-sm font-semibold">{workspaceName}</div>
        <p className="text-xs text-muted">{workspaceText}</p>
      </header>

      <PanelEmbeddedNav />

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 py-4 sm:px-5 sm:py-5">{children}</div>
      </main>
    </div>
  );
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    if (window.parent !== window) {
      try {
        window.parent.postMessage({ type: "dp-panel:ready" }, PANEL_PARENT_ORIGIN);
      } catch {
        // Private mode or sandboxed iframe: parent messaging is optional at runtime.
      }
    }

    const handler = (event: MessageEvent) => {
      if (!isValidPanelThemeEvent(event)) return;

      const theme = extractPanelTheme(event.data);
      if (!theme) return;

      setEmbedded(true);
      applyTheme(theme, { persist: false });
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
    };
  }, []);

  // Keep legacy shell for standalone usage and avoid writing embedded mode into
  // localStorage. In embedded mode, parent controls theme and sends an explicit
  // ready signal once detected.
  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div className="flex h-dvh overflow-hidden bg-background">
      {!embedded ? (
        <>
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            workspaceName={workspaceName}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TopBar
              onMenuClick={() => setSidebarOpen(true)}
              instagramUsername={instagramUsername}
              instagramAccountCount={instagramAccountCount}
            />

            {/* overflow-x-hidden: enabling vertical scrolling makes the browser
                allow horizontal scrolling too, which lets a wide child drag the
                whole page sideways on a phone. */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="px-4 lg:px-8 py-5 sm:py-6 max-w-7xl mx-auto">{children}</div>
            </main>
          </div>
        </>
      ) : (
        <DashboardShellEmbedded
          children={children}
          workspaceName={workspaceName}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />
      )}
    </div>
  );
}
