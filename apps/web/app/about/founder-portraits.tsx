/**
 * Illustrated founder portraits, drawn in SVG so they stay sharp at any size
 * and need no image files. They are deliberately not likenesses: the founders
 * are not named on the site.
 */

type Who = 'builder' | 'strategist';

type Look = {
  skin: string;
  skinShade: string;
  lip: string;
  hair: string;
  hairLight: string;
  iris: string;
  backdrop: [string, string];
  ink: string;
  cursor: string;
};

const LOOKS: Record<Who, Look> = {
  builder: {
    skin: '#e9b48c',
    skinShade: '#cf9169',
    lip: '#b56a55',
    hair: '#17141f',
    hairLight: '#3b3352',
    iris: '#3d2516',
    backdrop: ['#ffd9c2', '#ff9f80'],
    ink: '#1b1b1b',
    cursor: '#3b5bdb',
  },
  strategist: {
    skin: '#dca57f',
    skinShade: '#bf8560',
    lip: '#a45f4b',
    hair: '#151515',
    hairLight: '#3a3a3a',
    iris: '#2e1c12',
    backdrop: ['#cfe8ff', '#8fc3f5'],
    ink: '#1b1b1b',
    cursor: '#e8590c',
  },
};

function Eye({ cx, look }: { cx: number; look: Look }) {
  return (
    <g>
      <path
        d={`M${cx - 15} 202 C${cx - 8} 192 ${cx + 8} 192 ${cx + 15} 202 C${cx + 8} 208 ${cx - 8} 208 ${cx - 15} 202 Z`}
        fill="#fbf7f2"
      />
      <circle cx={cx} cy={201} r={6.5} fill={look.iris} />
      <circle cx={cx} cy={201} r={3} fill="#0b0b0b" />
      <circle cx={cx + 2.2} cy={198.6} r={1.7} fill="#fff" />
      <path
        d={`M${cx - 16} 202 C${cx - 8} 190 ${cx + 8} 190 ${cx + 16} 201`}
        fill="none"
        stroke="#1a1410"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  );
}

/** A small live-cursor tag, the way people appear on an Avenor board. */
function CursorTag({
  x,
  y,
  label,
  color,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
}) {
  const width = 14 + label.length * 8.4;
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M0 0 L0 22 L6 16 L10 26 L14 24 L10 14 L18 14 Z"
        fill={color}
        stroke="#fff"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <rect x={16} y={22} width={width} height={24} rx={12} fill={color} />
      <text
        x={16 + width / 2}
        y={38.5}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill="#fff"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

function Backdrop({ id, look }: { id: string; look: Look }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={look.backdrop[0]} />
          <stop offset="1" stopColor={look.backdrop[1]} />
        </linearGradient>
        <pattern
          id={`${id}-dots`}
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="1.6" fill="#000" opacity="0.12" />
        </pattern>
      </defs>
      <rect width="400" height="480" fill={`url(#${id}-bg)`} />
      <rect width="400" height="480" fill={`url(#${id}-dots)`} />
      {/* Ink scribbles, as if drawn on the board behind them. */}
      <path
        d="M34 96 C70 52 128 60 118 104 C110 140 58 128 82 92 C100 66 150 70 170 58"
        fill="none"
        stroke={look.ink}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.55}
      />
      <path
        d="M292 70 l36 0 M310 52 l0 36 M300 114 l22 -22"
        stroke={look.ink}
        strokeWidth={4}
        strokeLinecap="round"
        opacity={0.45}
      />
      <circle
        cx="340"
        cy="150"
        r="22"
        fill="none"
        stroke={look.ink}
        strokeWidth={4}
        opacity={0.4}
      />
    </>
  );
}

function Body({ who, look }: { who: Who; look: Look }) {
  const neck = (
    <>
      <path d="M176 252 L224 252 L228 312 L172 312 Z" fill={look.skin} />
      <path
        d="M176 252 L224 252 L225 276 C210 286 190 286 175 276 Z"
        fill={look.skinShade}
      />
    </>
  );
  if (who === 'builder')
    return (
      <g>
        {neck}
        {/* Hoodie */}
        <path
          d="M40 480 C44 384 96 330 168 310 L232 310 C304 330 356 384 360 480 Z"
          fill="#2f4fd1"
        />
        <path
          d="M40 480 C44 400 80 352 128 330 C118 380 116 430 120 480 Z"
          fill="#243fae"
        />
        <path
          d="M360 480 C356 400 320 352 272 330 C282 380 284 430 280 480 Z"
          fill="#243fae"
        />
        <path
          d="M146 314 C160 360 240 360 254 314 C246 302 154 302 146 314 Z"
          fill="#1e3494"
        />
        <path
          d="M164 318 C176 344 224 344 236 318"
          fill="none"
          stroke="#16297a"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d="M184 340 L180 400 M216 340 L220 400"
          stroke="#f1f3ff"
          strokeWidth={4}
          strokeLinecap="round"
        />
        <circle cx="180" cy="404" r="5" fill="#f1f3ff" />
        <circle cx="220" cy="404" r="5" fill="#f1f3ff" />
      </g>
    );
  return (
    <g>
      {neck}
      {/* Blazer over an open-collar shirt */}
      <path
        d="M40 480 C44 384 96 332 168 312 L232 312 C304 332 356 384 360 480 Z"
        fill="#24324a"
      />
      <path d="M168 312 L200 400 L232 312 Z" fill="#f4f1ea" />
      <path d="M168 312 L186 300 L200 336 Z" fill="#ffffff" />
      <path d="M232 312 L214 300 L200 336 Z" fill="#ffffff" />
      <path
        d="M164 314 L200 420 L150 480 L118 480 C126 410 140 350 164 314 Z"
        fill="#1a2538"
      />
      <path
        d="M236 314 L200 420 L250 480 L282 480 C274 410 260 350 236 314 Z"
        fill="#1a2538"
      />
      <path
        d="M164 314 L186 372 L168 380 L200 420"
        fill="none"
        stroke="#2f405f"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path
        d="M236 314 L214 372 L232 380 L200 420"
        fill="none"
        stroke="#2f405f"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <path d="M262 392 l26 0 l-2 10 l-22 0 Z" fill="#f4f1ea" opacity={0.9} />
    </g>
  );
}

function Head({ who, look }: { who: Who; look: Look }) {
  const face =
    'M140 176 C140 124 166 102 200 102 C234 102 260 124 260 176 L258 208 C255 246 230 272 200 274 C170 272 145 246 142 208 Z';
  return (
    <g>
      {/* Ears */}
      <ellipse cx="141" cy="204" rx="12" ry="19" fill={look.skinShade} />
      <ellipse cx="259" cy="204" rx="12" ry="19" fill={look.skinShade} />
      <path d={face} fill={look.skin} />
      {/* Soft shading down one side of the face */}
      <path
        d="M232 112 C252 124 260 148 260 176 L258 208 C255 246 230 272 200 274 C226 256 240 224 242 190 C244 158 240 132 232 112 Z"
        fill={look.skinShade}
        opacity={0.45}
      />
      <ellipse cx="166" cy="232" rx="13" ry="7" fill="#e07a6a" opacity={0.18} />
      <ellipse cx="234" cy="232" rx="13" ry="7" fill="#e07a6a" opacity={0.18} />

      {who === 'strategist' && (
        <>
          {/* Trimmed beard and moustache */}
          <path
            d="M142 206 C146 250 172 280 200 282 C228 280 254 250 258 206 C250 228 238 240 224 242 C214 234 186 234 176 242 C162 240 150 228 142 206 Z"
            fill={look.hair}
            opacity={0.88}
          />
          <path
            d="M176 238 C186 228 214 228 224 238 C214 242 186 242 176 238 Z"
            fill={look.hair}
          />
        </>
      )}

      <Eye cx={174} look={look} />
      <Eye cx={226} look={look} />

      {/* Eyebrows */}
      <path
        d={
          who === 'builder'
            ? 'M156 182 C166 175 180 175 190 180'
            : 'M154 180 C166 172 180 172 191 178'
        }
        fill="none"
        stroke={look.hair}
        strokeWidth={who === 'builder' ? 6 : 7}
        strokeLinecap="round"
      />
      <path
        d={
          who === 'builder'
            ? 'M210 180 C220 175 234 175 244 182'
            : 'M209 178 C220 172 234 172 246 180'
        }
        fill="none"
        stroke={look.hair}
        strokeWidth={who === 'builder' ? 6 : 7}
        strokeLinecap="round"
      />

      {/* Nose */}
      <path
        d="M201 206 C198 218 194 224 199 228 C203 230 207 228 209 225"
        fill="none"
        stroke={look.skinShade}
        strokeWidth={3}
        strokeLinecap="round"
      />

      {/* Mouth */}
      {who === 'builder' ? (
        <>
          <path
            d="M182 246 C192 258 210 258 220 246 C210 250 192 250 182 246 Z"
            fill="#fff"
            stroke={look.lip}
            strokeWidth={3}
            strokeLinejoin="round"
          />
        </>
      ) : (
        <path
          d="M186 248 C194 255 208 255 216 248"
          fill="none"
          stroke={look.lip}
          strokeWidth={4}
          strokeLinecap="round"
        />
      )}

      {/* Hair */}
      {who === 'builder' ? (
        <>
          <path
            d="M134 186 C122 128 150 82 202 80 C252 78 282 118 268 186 C262 160 252 142 236 132 C228 146 210 150 192 146 C180 154 162 156 150 150 C144 160 138 172 134 186 Z"
            fill={look.hair}
          />
          <path
            d="M150 112 C160 96 178 88 196 92 C182 98 172 108 166 122 Z M206 90 C226 88 244 98 254 114 C238 106 222 104 210 108 Z"
            fill={look.hairLight}
          />
          <path
            d="M192 146 C200 132 214 124 230 122 C222 132 214 140 204 146 Z"
            fill={look.hair}
          />
        </>
      ) : (
        <>
          <path
            d="M136 182 C130 126 160 92 204 92 C246 92 270 124 264 180 C258 152 246 132 222 122 C196 134 164 136 144 150 C140 160 138 170 136 182 Z"
            fill={look.hair}
          />
          <path
            d="M160 114 C176 100 200 96 222 100 C200 104 182 112 170 124 Z"
            fill={look.hairLight}
          />
          {/* Glasses */}
          <g fill="none" stroke="#1d1d1d" strokeWidth={4}>
            <rect x="152" y="188" width="44" height="30" rx="10" />
            <rect x="204" y="188" width="44" height="30" rx="10" />
            <path d="M196 200 C199 196 201 196 204 200" />
            <path d="M152 198 L142 194 M248 198 L258 194" />
          </g>
          <path
            d="M160 194 l10 0 M212 194 l10 0"
            stroke="#fff"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.6}
          />
        </>
      )}
    </g>
  );
}

export function FounderPortrait({ who, title }: { who: Who; title: string }) {
  const look = LOOKS[who];
  const id = `portrait-${who}`;
  return (
    <svg
      className="founder-portrait"
      viewBox="0 0 400 480"
      role="img"
      aria-labelledby={`${id}-title`}
    >
      <title id={`${id}-title`}>{title}</title>
      <Backdrop id={id} look={look} />
      <Body who={who} look={look} />
      <Head who={who} look={look} />
      <CursorTag
        x={who === 'builder' ? 276 : 40}
        y={who === 'builder' ? 236 : 250}
        label={who === 'builder' ? 'Builder' : 'Strategist'}
        color={look.cursor}
      />
    </svg>
  );
}
