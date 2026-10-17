/** Stroke icons drawn on a 24px grid. */
const PATHS = {
  select: <path d="M5 3.5 18.5 10l-6.2 1.6L9.6 18z" strokeLinejoin="round" />,
  hand: (
    <>
      <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10.5v-6a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L3.6 15a1.6 1.6 0 0 1 2.4-2l2 2" />
    </>
  ),
  pen: (
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
      <path d="m14.5 5.5 3 3" />
    </>
  ),
  marker: (
    <>
      <path d="m9 11 5.5-5.5a2.1 2.1 0 0 1 3 3L12 14" />
      <path d="m9 11-3 3 1 1-2 3h4l1-1 1 1 3-3z" />
      <path d="M14 20h6" />
    </>
  ),
  eraser: (
    <>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </>
  ),
  rect: <rect x="3.5" y="5" width="17" height="14" rx="2.5" />,
  ellipse: <circle cx="12" cy="12" r="8.5" />,
  diamond: <path d="M12 3 21 12 12 21 3 12z" strokeLinejoin="round" />,
  line: <path d="M5 19 19 5" />,
  arrow: (
    <>
      <path d="M5 19 19 5" />
      <path d="M9 5h10v10" />
    </>
  ),
  text: (
    <>
      <path d="M5 6V4.5h14V6" />
      <path d="M12 4.5v15" />
      <path d="M9 19.5h6" />
    </>
  ),
  sticky: (
    <>
      <path d="M15.5 20.5H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h14A1.5 1.5 0 0 1 20.5 5v10.5z" />
      <path d="M15 20.5V16a1 1 0 0 1 1-1h4.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="m21 15.5-4.6-4.6a1.5 1.5 0 0 0-2.1 0L4.5 20.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
    </>
  ),
  chat: (
    <path d="M20.5 14.5a2 2 0 0 1-2 2H8l-4.5 4V5.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
  ),
  share: (
    <>
      <path d="M12 3v12" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M20 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V14" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M20 15v3.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V15" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 6.5 7 19a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 19l1-12.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  pages: (
    <>
      <path d="M8 3.5h8.5l3 3V17a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 17V5A1.5 1.5 0 0 1 8 3.5z" />
      <path d="M6.5 7H5a1.5 1.5 0 0 0-1.5 1.5V20A1.5 1.5 0 0 0 5 21.5h9.5A1.5 1.5 0 0 0 16 20v-1.5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  save: (
    <>
      <path d="M5.5 3.5h10l4 4v11a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M7.5 3.5v5h7v-5" />
      <rect x="7.5" y="13" width="9" height="7.5" rx="1" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 14.3a6.5 6.5 0 0 1 3 5.7" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01M18 9.5h.01M6 13h.01M18 13h.01M9 15.5h6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3" />
      <path d="M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M16 16.4A6.5 6.5 0 0 1 5.5 11" />
      <path d="M12 17.5V21" />
      <path d="m3.5 3.5 17 17" />
    </>
  ),
  phoneOff: (
    <>
      <path d="M10.7 13.3a13 13 0 0 1-2.4-3.2l1.4-1.4a1.5 1.5 0 0 0 .3-1.7L8.6 4.3A1.5 1.5 0 0 0 6.9 3.4l-2.4.7A1.6 1.6 0 0 0 3.4 5.8 17.5 17.5 0 0 0 7 13" />
      <path d="M10 17a17.5 17.5 0 0 0 8.2 3.6 1.6 1.6 0 0 0 1.7-1.1l.7-2.4a1.5 1.5 0 0 0-.9-1.7l-2.7-1.1a1.5 1.5 0 0 0-1.7.3L14 15.9" />
      <path d="m3 21 18-18" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  logout: (
    <>
      <path d="M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9" />
      <path d="m16 16.5 4.5-4.5L16 7.5" />
      <path d="M20.5 12H9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M10 20.5v-6h4v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.5-4.5" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  list: (
    <path d="M8.5 6h12M8.5 12h12M8.5 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  ),
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20.5h8.5" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  sparkle: (
    <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" />
      <path d="M5.8 5.3 3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5l-2.3-8.2a1.5 1.5 0 0 0-1.4-1.1H7.2a1.5 1.5 0 0 0-1.4 1.1z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </>
  ),
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" strokeLinejoin="round" />,
  record: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
      <path d="M12 16.8h.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The CanvaRoom mark: a stroke crossing a frame. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M8 21.5c2.2-6.4 4.7-9.6 7.4-9.6 3.6 0 1.4 8.2 4.6 8.2 1.6 0 3-2 4-5.6"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="24.2" cy="9.6" r="2.2" fill="#fff" />
    </svg>
  );
}
