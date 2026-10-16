/**
 * Anime-style placeholder portraits for the founders, drawn in SVG so they
 * stay sharp at any size and need no image files. Swap for photos later by
 * replacing `<FounderPortrait>` with an `<img>`.
 */

type Look = {
  skin: string;
  skinShade: string;
  hair: string;
  hairLight: string;
  eyes: string;
  top: string;
  topShade: string;
  backdrop: [string, string];
};

const LOOKS: Record<'divyansh' | 'karambir', Look> = {
  divyansh: {
    skin: '#f3c9a4',
    skinShade: '#e3a982',
    hair: '#1f1b2e',
    hairLight: '#3d3560',
    eyes: '#4a2f1c',
    top: '#3b5bdb',
    topShade: '#2c46b0',
    backdrop: ['#ffd8a8', '#ffa8a8'],
  },
  karambir: {
    skin: '#eebf98',
    skinShade: '#d99f78',
    hair: '#171717',
    hairLight: '#3a3a3a',
    eyes: '#3b2416',
    top: '#2f9e44',
    topShade: '#237a34',
    backdrop: ['#b2f2bb', '#a5d8ff'],
  },
};

function Eye({ x, color, flip }: { x: number; color: string; flip?: boolean }) {
  const s = flip ? -1 : 1;
  return (
    <g transform={`translate(${x} 0) scale(${s} 1)`}>
      {/* lash line */}
      <path
        d="M-17 -6 Q-2 -17 16 -8"
        fill="none"
        stroke="#1b1424"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <ellipse cx="0" cy="4" rx="12" ry="14" fill="#fff" />
      <ellipse cx="0.5" cy="6" rx="9.5" ry="12" fill={color} />
      <ellipse cx="0.5" cy="8" rx="5" ry="6.5" fill="#120c08" />
      <ellipse cx="-3.5" cy="0" rx="3.6" ry="4.4" fill="#fff" />
      <circle cx="4" cy="12" r="1.8" fill="#fff" opacity="0.85" />
    </g>
  );
}

export function FounderPortrait({
  who,
  title,
}: {
  who: 'divyansh' | 'karambir';
  title: string;
}) {
  const look = LOOKS[who];
  const id = `founder-${who}`;
  return (
    <svg
      viewBox="0 0 240 240"
      role="img"
      aria-label={title}
      className="founder-portrait"
    >
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={look.backdrop[0]} />
          <stop offset="1" stopColor={look.backdrop[1]} />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="120" cy="120" r="120" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="240" height="240" fill={`url(#${id}-bg)`} />
        {/* whiteboard doodles in the backdrop */}
        <g
          fill="none"
          stroke="#fff"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        >
          <path d="M22 60 q14 -18 28 0 t28 0" />
          <path d="M184 40 l18 18 m0 -18 l-18 18" />
          <circle cx="200" cy="150" r="12" />
          <path d="M26 170 l20 -14 l14 18" />
        </g>

        {/* shoulders and top */}
        <path d="M30 250 Q36 182 120 176 Q204 182 210 250 Z" fill={look.top} />
        <path d="M92 180 L120 214 L148 180 Z" fill={look.topShade} />
        {who === 'divyansh' ? (
          // hoodie strings
          <g stroke="#e7ecff" strokeWidth="3.5" strokeLinecap="round">
            <path d="M108 192 v24" />
            <path d="M132 192 v24" />
          </g>
        ) : (
          // collar
          <g fill="#f1f3f5">
            <path d="M94 180 L120 204 L104 214 L86 188 Z" />
            <path d="M146 180 L120 204 L136 214 L154 188 Z" />
          </g>
        )}

        {/* neck */}
        <path d="M104 150 h32 v34 q-16 10 -32 0 Z" fill={look.skinShade} />

        {/* back hair */}
        <path
          d="M56 104 Q50 40 120 34 Q190 40 184 104 Q186 140 170 150 L70 150 Q54 140 56 104 Z"
          fill={look.hair}
        />

        {/* face */}
        <path
          d="M66 100 Q66 60 120 58 Q174 60 174 100 Q174 150 120 166 Q66 150 66 100 Z"
          fill={look.skin}
        />
        {/* ears */}
        <ellipse cx="66" cy="108" rx="8" ry="12" fill={look.skin} />
        <ellipse cx="174" cy="108" rx="8" ry="12" fill={look.skin} />

        {/* eyes */}
        <g transform="translate(0 106)">
          <Eye x={96} color={look.eyes} />
          <Eye x={144} color={look.eyes} flip />
        </g>
        {/* brows */}
        <g stroke={look.hair} strokeWidth="4" strokeLinecap="round">
          <path d="M82 86 Q96 80 108 84" fill="none" />
          <path d="M132 84 Q144 80 158 86" fill="none" />
        </g>
        {/* nose, blush, smile */}
        <path
          d="M120 124 l-3 6 h5"
          fill="none"
          stroke={look.skinShade}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <ellipse
          cx="86"
          cy="134"
          rx="9"
          ry="4.5"
          fill="#ff8787"
          opacity="0.45"
        />
        <ellipse
          cx="154"
          cy="134"
          rx="9"
          ry="4.5"
          fill="#ff8787"
          opacity="0.45"
        />
        <path
          d="M106 142 Q120 154 134 142 Q120 148 106 142 Z"
          fill="#a33a3a"
          stroke="#7a2626"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* front hair */}
        {who === 'divyansh' ? (
          <g>
            <path
              d="M58 98 Q56 44 120 40 Q186 44 182 98 L170 76 L160 94 L148 66 L136 90 L124 62 L110 90 L98 66 L86 94 L76 74 Z"
              fill={look.hair}
            />
            <path
              d="M96 50 Q120 42 146 50"
              fill="none"
              stroke={look.hairLight}
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g>
            <path
              d="M58 100 Q54 42 122 40 Q184 44 182 100 Q172 70 140 66 Q150 78 146 88 Q126 66 96 70 Q82 76 72 92 Z"
              fill={look.hair}
            />
            <path
              d="M100 52 Q126 44 152 54"
              fill="none"
              stroke={look.hairLight}
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* glasses */}
            <g
              fill="none"
              stroke="#212529"
              strokeWidth="3.5"
              transform="translate(0 110)"
            >
              <rect x="78" y="-14" width="36" height="30" rx="10" />
              <rect x="126" y="-14" width="36" height="30" rx="10" />
              <path d="M114 -2 h12" />
            </g>
          </g>
        )}

        {/* a stylus, for the whiteboard */}
        <g transform="translate(-22 -26) rotate(-28 196 206)">
          <rect x="186" y="170" width="12" height="64" rx="6" fill="#fff" />
          <rect x="186" y="170" width="12" height="14" rx="6" fill="#fab005" />
          <path d="M186 228 L192 244 L198 228 Z" fill="#495057" />
        </g>
      </g>
    </svg>
  );
}
