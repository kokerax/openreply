"use client";

/**
 * Theme: light / dark, stored in localStorage, system as the default.
 * ThemeScript runs before paint so the page never flashes the wrong theme.
 */

import { useEffect, useState } from "react";
import { IconMoon, IconSun } from "@/components/icons";

export const THEME_KEY = "openreply:theme";
export type Theme = "light" | "dark";

const BOOT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT }} />;
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice just doesn't persist.
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => setTheme(readTheme()), []);
  return [
    theme,
    (t: Theme) => {
      applyTheme(t);
      setTheme(t);
    },
  ];
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={`btn btn-ghost btn-icon ${className}`}
      aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
      title={next === "dark" ? "Dark theme" : "Light theme"}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
