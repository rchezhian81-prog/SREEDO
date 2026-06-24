import type { ReactNode, SVGProps } from "react";

/*
 * GoCampus icon set — crisp, professional line icons rendered with
 * `currentColor` so they inherit text colour. No external dependency.
 * Size them with a className (e.g. `h-5 w-5`); colour follows text colour.
 */

const PATHS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.5 19.5c0-3 2.6-4.9 5.5-4.9s5.5 1.9 5.5 4.9" />
      <path d="M16.4 5.2a3.3 3.3 0 010 6.2" />
      <path d="M17.6 14.9c2 .5 3.4 1.9 3.4 4.1" />
    </>
  ),
  cap: (
    <>
      <path d="M12 4.2L22 9l-10 4.8L2 9z" />
      <path d="M6 11v4.2c0 1.5 2.7 2.9 6 2.9s6-1.4 6-2.9V11" />
      <path d="M22 9v4.8" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8.5 20h7M7.5 11l2.4-2.4 2 2 3.1-3.4" />
    </>
  ),
  school: (
    <>
      <path d="M3 21h18M5 21V9.5l7-4 7 4V21" />
      <path d="M9.5 21v-5h5v5M12 5.5V3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.6" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  calcheck: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.6" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M8.5 15l2.4 2.4 4.2-4.6" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.5h7l4.5 4.5V20a1 1 0 01-1 1H7a1 1 0 01-1-1V4.5a1 1 0 011-1z" />
      <path d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h5" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.6" />
      <path d="M3 10h18M7 14.5h3" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 8.5A2.5 2.5 0 015.5 6H18a1 1 0 011 1v1.5" />
      <rect x="3" y="8" width="18" height="11" rx="2.6" />
      <circle cx="16.5" cy="13.5" r="1.3" />
    </>
  ),
  megaphone: (
    <>
      <path d="M5 10v4a1 1 0 001 1h2.4L13 18.5v-13L8.4 9H6a1 1 0 00-1 1z" />
      <path d="M16 9.5a3.5 3.5 0 010 5M8.5 15v3a1.5 1.5 0 003 0v-2.4" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z" />
      <path d="M18.5 4v3M20 5.5h-3M5.5 16v2.5M6.75 17.25h-2.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9.5 20.5v-4h5v4" />
    </>
  ),
  package: (
    <>
      <path d="M21 8l-9-4.5L3 8l9 4.5z" />
      <path d="M3 8v8l9 4.5 9-4.5V8M12 12.5V21M7.5 6.2l9 4.5" />
    </>
  ),
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 10-12 0c0 5.5-2.2 6.8-2.2 6.8h16.4S18 15 18 9.5z" />
      <path d="M10 20a2.2 2.2 0 004 0" />
    </>
  ),
  message: (
    <path d="M20.5 11.4a7.4 7 0 01-10.2 6.5L4 19.5l1.6-4.1A7 7 0 1120.5 11.4z" />
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.6" />
      <path d="M3.5 7.5l8.5 6 8.5-6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5V5M12 19v2.5M21.5 12H19M5 12H2.5M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4L5.6 5.6" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  chevronLeft: <path d="M14.5 6l-6 6 6 6" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  logout: (
    <>
      <path d="M15 4.5h3a1 1 0 011 1v13a1 1 0 01-1 1h-3" />
      <path d="M10 12h11M17.5 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  help: (
    <>
      <path d="M4 13.5v-1.5a8 8 0 0116 0v1.5" />
      <rect x="3" y="13" width="4" height="6" rx="1.6" />
      <rect x="17" y="13" width="4" height="6" rx="1.6" />
      <path d="M21 19a3 3 0 01-3 3h-2.5" />
    </>
  ),
  trendUp: (
    <>
      <path d="M4 17l5.5-5.5 4 4L21 8" />
      <path d="M15 8h6v6" />
    </>
  ),
  trendDown: (
    <>
      <path d="M4 7l5.5 5.5 4-4L21 16" />
      <path d="M15 16h6v-6" />
    </>
  ),
  check: <path d="M4 12.5l5 5 11-11" />,
  userPlus: (
    <>
      <circle cx="9.5" cy="8" r="3.4" />
      <path d="M3.5 20c0-3.3 2.9-5 6-5 .9 0 1.8.1 2.6.4" />
      <path d="M18 14.5v6M15 17.5h6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.6" />
      <path d="M8.5 7.5V6a2 2 0 012-2h3a2 2 0 012 2v1.5M3.5 13h17" />
    </>
  ),
  barChart: (
    <>
      <path d="M5 20.5V11M12 20.5V4M19 20.5v-6" />
      <path d="M3.5 20.5h17" />
    </>
  ),
  star: (
    <path d="M12 3.5l2.6 5.2 5.8.9-4.2 4.1 1 5.7L12 16.8l-5.2 2.6 1-5.7L3.6 9.6l5.8-.9z" />
  ),
  wrench: (
    <path d="M14.5 6.2a4 4 0 00-5.2 5.2l-5.4 5.4a1.8 1.8 0 002.5 2.5l5.4-5.4a4 4 0 005.2-5.2l-2.5 2.5-2-2z" />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7L5.6 5.6" />
    </>
  ),
  bus: (
    <>
      <rect x="4" y="4.5" width="16" height="12" rx="2.6" />
      <path d="M4 11.5h16" />
      <path d="M7 16.5v2.5M17 16.5v2.5" />
      <circle cx="8" cy="14" r="1" />
      <circle cx="16" cy="14" r="1" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 16h.01" />
    </>
  ),
  health: (
    <>
      <rect x="3.2" y="6.5" width="17.6" height="13.5" rx="2.6" />
      <path d="M8.5 6.5V5.2A2.2 2.2 0 0110.7 3h2.6a2.2 2.2 0 012.2 2.2v1.3" />
      <path d="M12 10.5v6M9 13.5h6" />
    </>
  ),
  utensils: (
    <>
      <path d="M3.5 18.5h17" />
      <path d="M5 18.5a7 7 0 0114 0" />
      <path d="M12 11.5V9" />
    </>
  ),
  bookOpen: (
    <>
      <path d="M12 7C10.3 5.8 8.4 5.5 6 5.5H3.5v12H6c2.4 0 4.3.3 6 1.5" />
      <path d="M12 7c1.7-1.2 3.6-1.5 6-1.5h2.5v12H18c-2.4 0-4.3.3-6 1.5" />
      <path d="M12 7v12" />
    </>
  ),
  quiz: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2.2" />
      <path d="M9 4.5V4a1.4 1.4 0 011.4-1.4h3.2A1.4 1.4 0 0115 4v.5z" />
      <path d="M8.7 12.2l2.1 2.1 4.3-4.6" />
    </>
  ),
  fingerprint: (
    <>
      <path d="M5.5 10.5a7 7 0 0113 0" />
      <path d="M8.5 11.5a3.6 3.6 0 017 .5" />
      <path d="M12 12v5.5" />
      <path d="M8.8 16.5a8 8 0 00.7 3.2" />
      <path d="M15.4 14.8c.2 2-.2 3.8-1 5.2" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.6" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M20 15.5l-4.8-4.8L6 20" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 010-5l2.5-2.5a3.5 3.5 0 015 5l-1.3 1.3" />
      <path d="M13.5 10.5a3.5 3.5 0 010 5L11 18a3.5 3.5 0 01-5-5l1.3-1.3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 100 17c1.3 0 2.1-1 2.1-2.1 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2H17a3.5 3.5 0 003.5-3.5C20.5 6.8 16.7 3.5 12 3.5z" />
      <circle cx="7.8" cy="11.6" r="1" />
      <circle cx="10.6" cy="7.8" r="1" />
      <circle cx="15" cy="8.4" r="1" />
    </>
  ),
  tag: (
    <>
      <path d="M3.6 12.4l8.8-8.8a1.8 1.8 0 011.3-.5h5a1.6 1.6 0 011.6 1.6v5a1.8 1.8 0 01-.5 1.3l-8.8 8.8a1.8 1.8 0 01-2.5 0l-4.9-4.9a1.8 1.8 0 010-2.5z" />
      <circle cx="16.3" cy="7.7" r="1.2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "h-5 w-5",
  strokeWidth = 1.85,
  ...props
}: { name: IconName; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}
