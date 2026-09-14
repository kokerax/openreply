import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  PANEL_PARENT_ORIGIN,
  extractPanelTheme,
  isValidPanelThemeEvent,
} from "@/components/dashboard-shell";
import { EMBEDDED_NAV_ITEMS } from "@/components/panel-embedded-nav";

const thisDir = dirname(fileURLToPath(import.meta.url));
const dashboardShellSource = readFileSync(resolve(thisDir, "../components/dashboard-shell.tsx"), "utf8");

describe("panel embed theme message validation", () => {
  let originalParent: unknown;

  beforeEach(() => {
    originalParent = typeof window === "undefined" ? undefined : window.parent;
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      (globalThis as unknown as { window: { parent: unknown } }).window.parent = originalParent as unknown;
    }
  });

  it("accepts only dp-panel:theme from exact panel origin and parent source", () => {
    const parent = {} as MessageEvent["source"];
    const validEvent = {
      origin: PANEL_PARENT_ORIGIN,
      source: parent,
      data: { type: "dp-panel:theme", theme: "dark" },
    } as MessageEvent;

    (globalThis as unknown as { window?: { parent: unknown } }).window = { parent };

    expect(isValidPanelThemeEvent(validEvent)).toBe(true);
    expect(extractPanelTheme(validEvent.data)).toBe("dark");
    expect(extractPanelTheme({ type: "dp-panel:theme", theme: "light" })).toBe("light");

    const badOriginEvent = {
      ...validEvent,
      origin: "https://evil.example",
    } as MessageEvent;

    expect(isValidPanelThemeEvent(badOriginEvent)).toBe(false);

    const wrongSourceEvent = {
      ...validEvent,
      source: {} as MessageEvent["source"],
    } as MessageEvent;
    expect(isValidPanelThemeEvent(wrongSourceEvent)).toBe(false);

    expect(isValidPanelThemeEvent({ ...validEvent, data: { type: "theme", theme: "dark" } } as MessageEvent)).toBe(false);
    expect(isValidPanelThemeEvent({ ...validEvent, data: { type: "dp-panel:theme", theme: "blue" } } as MessageEvent)).toBe(false);
  });

  it("extractPanelTheme validates message shape", () => {
    expect(extractPanelTheme({ type: "dp-panel:theme", theme: "light" })).toBe("light");
    expect(extractPanelTheme({ type: "dp-panel:theme", theme: "blue" })).toBe(null);
    expect(extractPanelTheme({ type: "other", theme: "light" })).toBe(null);
    expect(extractPanelTheme("dp-panel:theme")).toBe(null);
  });
});

describe("panel embedded navigation 9-item contract", () => {
  it("keeps exact 9 destination items", () => {
    expect(EMBEDDED_NAV_ITEMS).toHaveLength(9);
  });

  it("contains exact Turkish labels in order", () => {
    const labels = EMBEDDED_NAV_ITEMS.map((item) => item.label);
    expect(labels).toEqual(["Genel", "Gelen kutusu", "Otomasyonlar", "Gönderimler", "Kişiler", "Özet", "Eğilim", "Tanılama", "Ayarlar"]);
  });

  it("routes preserve existing dashboard targets", () => {
    const hrefs = EMBEDDED_NAV_ITEMS.map((item) => item.href);
    expect(hrefs).toEqual(["/dashboard", "/inbox", "/campaigns", "/logs", "/leads", "/overview", "/trend", "/diagnostics", "/settings"]);
  });

  it("places embedded nav between header and main in embedded shell", () => {
    const markerHeaderClose = dashboardShellSource.indexOf("</header>");
    const markerNav = dashboardShellSource.indexOf("<PanelEmbeddedNav />");
    const markerMain = dashboardShellSource.indexOf("<main className=\"min-h-0 flex-1 overflow-y-auto\">");
    expect(markerHeaderClose).toBeGreaterThanOrEqual(0);
    expect(markerNav).toBeGreaterThan(markerHeaderClose);
    expect(markerMain).toBeGreaterThan(markerNav);
  });

  it("uses bottom border on embedded nav", () => {
    const navSource = readFileSync(resolve(thisDir, "../components/panel-embedded-nav.tsx"), "utf8");
    expect(navSource).toContain('className="border-b border-border bg-background px-2 py-2"');
  });
});
