/**
 * Inline icon set. 20px, stroke-based, currentColor. No icon dependency.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const IconHome = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>
);
export const IconChart = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>
);
export const IconTrend = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
);
export const IconInbox = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 13l2.5-8h13L21 13" /><path d="M3 13v6h18v-6" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></svg>
);
export const IconMegaphone = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6" /><path d="M7 15l1 5h3l-1-5" /></svg>
);
export const IconList = (p: IconProps) => (
  <svg {...base(p)}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>
);
export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const IconActivity = (p: IconProps) => (
  <svg {...base(p)}><path d="M22 12h-4l-3 8-6-16-3 8H2" /></svg>
);
export const IconSun = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>
);
export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><path d="m5 12 5 5L20 7" /></svg>
);
export const IconX = (p: IconProps) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);
export const IconChevronUp = (p: IconProps) => (
  <svg {...base(p)}><path d="m18 15-6-6-6 6" /></svg>
);
export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);
export const IconLink = (p: IconProps) => (
  <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
);
export const IconMore = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
);
export const IconMail = (p: IconProps) => (
  <svg {...base(p)}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3 7 8.1 5.4a1.6 1.6 0 0 0 1.8 0L21 7" /></svg>
);
