/**
 * Hand-drawn whiteboard illustrations for the home page story. Plain SVG so
 * they render on the server, stay sharp, and follow the light/dark theme
 * through the `st-*` classes in story.css.
 */

const STICKY_INK = '#22201c';

function Paper({ id }: { id: string }) {
  return (
    <>
      <defs>
        <pattern id={id} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" className="st-dot" />
        </pattern>
      </defs>
      <rect x="4" y="4" width="552" height="392" rx="24" className="st-paper" />
      <rect x="4" y="4" width="552" height="392" rx="24" fill={`url(#${id})`} />
    </>
  );
}

function Cursor({
  x,
  y,
  label,
  color,
  className,
}: {
  x: number;
  y: number;
  label: string;
  color: string;
  className?: string;
}) {
  const width = 16 + label.length * 7.6;
  // Motion goes on an inner group: a CSS transform would replace the position.
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>
        <path
          d="M0 0 L0 20 L5.5 14.5 L9 23 L12.5 21.5 L9 13 L16 13 Z"
          fill={color}
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="14" y="19" width={width} height="22" rx="11" fill={color} />
        <text x={14 + width / 2} y="34" textAnchor="middle" className="st-tag">
          {label}
        </text>
      </g>
    </g>
  );
}

function Sticky({
  x,
  y,
  lines,
  rotate = 0,
  color = '#ffe066',
  width = 120,
}: {
  x: number;
  y: number;
  lines: string[];
  rotate?: number;
  color?: string;
  width?: number;
}) {
  const height = 34 + lines.length * 22;
  return (
    <g transform={`rotate(${rotate} ${x + width / 2} ${y + height / 2})`}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="6"
        fill={color}
        className="st-sticky"
      />
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + 14}
          y={y + 30 + index * 22}
          className="st-note"
          fill={STICKY_INK}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Bubble({
  x,
  y,
  text,
  tone = 'plain',
  tail = 'left',
}: {
  x: number;
  y: number;
  text: string;
  tone?: 'plain' | 'accent';
  tail?: 'left' | 'right';
}) {
  const width = 26 + text.length * 7.4;
  const tailX = tail === 'left' ? x + 18 : x + width - 18;
  return (
    <g className={tone === 'accent' ? 'st-bubble accent' : 'st-bubble'}>
      <rect x={x} y={y} width={width} height="34" rx="17" />
      <path
        d={`M${tailX - 7} ${y + 32} L${tailX} ${y + 44} L${tailX + 7} ${y + 32} Z`}
      />
      <text x={x + 13} y={y + 22}>
        {text}
      </text>
    </g>
  );
}

function Head({
  cx,
  cy,
  r = 18,
  color,
}: {
  cx: number;
  cy: number;
  r?: number;
  color: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <circle
        cx={cx - r * 0.32}
        cy={cy - r * 0.08}
        r={r * 0.1}
        fill="#1b1b1b"
      />
      <circle
        cx={cx + r * 0.32}
        cy={cy - r * 0.08}
        r={r * 0.1}
        fill="#1b1b1b"
      />
    </g>
  );
}

function Window({
  x,
  y,
  width,
  height,
  title,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="14"
        className="st-window"
      />
      <path d={`M${x} ${y + 30} L${x + width} ${y + 30}`} className="st-rule" />
      <circle cx={x + 16} cy={y + 15} r="4.5" fill="#ff8a7a" />
      <circle cx={x + 30} cy={y + 15} r="4.5" fill="#ffd166" />
      <circle cx={x + 44} cy={y + 15} r="4.5" fill="#7ed69a" />
      <text x={x + 60} y={y + 20} className="st-small">
        {title}
      </text>
    </g>
  );
}

const svgProps = (label: string) => ({
  viewBox: '0 0 560 400',
  role: 'img' as const,
  'aria-label': label,
  className: 'st-art',
});

/** 1. The drawing arrives seconds after the explanation. */
export function LagArt() {
  return (
    <svg
      {...svgProps(
        'A video class where the teacher’s drawing is still loading for students',
      )}
    >
      <Paper id="st-lag" />
      <Window
        x={30}
        y={30}
        width={360}
        height={300}
        title="Shared whiteboard"
      />
      {/* What has arrived so far, and what is still on its way. */}
      <path d="M90 270 L190 110" className="st-ink" />
      <path d="M190 110 L300 270 L90 270" className="st-ink st-ghost" />
      <g transform="translate(300 120)">
        <g className="st-spin">
          <circle r="18" className="st-ring" />
          <path d="M0 -18 A18 18 0 0 1 18 0" className="st-ring-on" />
        </g>
      </g>
      <g transform="translate(66 290)">
        <rect width="132" height="26" rx="13" className="st-alert" />
        <text x="66" y="17.5" textAnchor="middle" className="st-tag">
          3.2 s behind
        </text>
      </g>
      {/* Students in the call. */}
      {[
        ['#ffc9a8', 66],
        ['#a5d8ff', 168],
        ['#b2f2bb', 270],
      ].map(([color, y]) => (
        <g key={y as number}>
          <rect
            x="408"
            y={(y as number) - 34}
            width="122"
            height="86"
            rx="12"
            className="st-tile"
          />
          <Head cx={469} cy={(y as number) + 4} color={color as string} />
        </g>
      ))}
      <Bubble x={336} y={346} text="can u see it??" tail="right" />
    </svg>
  );
}

/** 2. A call, a board, and a chat in three different windows. */
export function JuggleArt() {
  return (
    <svg
      {...svgProps(
        'Three separate windows for the call, the whiteboard, and the chat',
      )}
    >
      <Paper id="st-juggle" />
      <g transform="rotate(-5 160 170)">
        <Window x={34} y={60} width={250} height={190} title="Video call" />
        <Head cx={110} cy={160} r={24} color="#ffc9a8" />
        <Head cx={200} cy={160} r={24} color="#a5d8ff" />
        <rect x="120" y="212" width="64" height="22" rx="11" fill="#ff6b6b" />
      </g>
      <g transform="rotate(3 330 200)">
        <Window
          x={196}
          y={110}
          width={260}
          height={200}
          title="Whiteboard — tab 7"
        />
        <path
          d="M232 250 C262 186 300 270 334 206 S396 236 420 180"
          className="st-ink"
        />
      </g>
      <g transform="rotate(-2 460 280)">
        <Window x={340} y={214} width={190} height={150} title="Chat" />
        <rect
          x="356"
          y="262"
          width="120"
          height="14"
          rx="7"
          className="st-bar"
        />
        <rect
          x="356"
          y="286"
          width="150"
          height="14"
          rx="7"
          className="st-bar"
        />
        <rect
          x="356"
          y="310"
          width="96"
          height="14"
          rx="7"
          className="st-bar accent"
        />
      </g>
      {/* The pointer racing between them. */}
      <path
        d="M120 320 C170 360 250 360 300 340"
        className="st-ink-thin st-dash"
      />
      <path
        d="M440 110 C470 70 500 80 512 120"
        className="st-ink-thin st-dash"
      />
      <Cursor
        x={290}
        y={330}
        label="where was I?"
        color="#868e96"
        className="st-bob"
      />
    </svg>
  );
}

/** 3. One person draws; everyone else waits. */
export function OnePenArt() {
  return (
    <svg
      {...svgProps(
        'Only the teacher can draw while students raise their hands',
      )}
    >
      <Paper id="st-pen" />
      <rect
        x="40"
        y="36"
        width="480"
        height="210"
        rx="16"
        className="st-window"
      />
      <path
        d="M90 196 C130 96 190 96 220 160 S300 214 340 120"
        className="st-ink"
      />
      <text x="370" y="132" className="st-hand">
        f(x) = ?
      </text>
      <Cursor x={340} y={120} label="Teacher" color="#3b5bdb" />
      <g transform="translate(424 52)">
        <rect width="80" height="26" rx="13" className="st-chip" />
        <rect x="12" y="10" width="11" height="9" rx="2" className="st-lock" />
        <path d="M14.5 10 v-2.5 a3 3 0 0 1 6 0 V10" className="st-lock-loop" />
        <text x="30" y="17.5" className="st-small">
          View only
        </text>
      </g>
      {[
        ['#ffc9a8', 110],
        ['#a5d8ff', 220],
        ['#b2f2bb', 330],
        ['#ffd8a8', 440],
      ].map(([color, x], index) => (
        <g key={x as number}>
          <Head cx={x as number} cy={318} r={24} color={color as string} />
          <path
            d={`M${(x as number) + 22} 312 L${(x as number) + 34} 262`}
            className={`st-arm${index % 2 ? ' st-wave' : ''}`}
          />
          <circle
            cx={(x as number) + 35}
            cy={258}
            r="7"
            fill={color as string}
          />
        </g>
      ))}
      <Bubble x={166} y={262} text="can I try?" />
    </svg>
  );
}

/** 4. The Wi-Fi drops and the board is gone. */
export function DropArt() {
  return (
    <svg {...svgProps('The connection drops and half the board disappears')}>
      <Paper id="st-drop" />
      <path d="M70 290 L170 120 L270 290 Z" className="st-ink" />
      <path d="M170 120 L170 290" className="st-ink-thin st-dash" />
      <path d="M330 180 C360 140 420 140 450 190" className="st-ink st-fade" />
      <path d="M340 260 h110" className="st-ink st-fade" />
      <g transform="translate(330 70)">
        <path d="M0 26 A44 44 0 0 1 88 26" className="st-wifi" />
        <path d="M16 40 A26 26 0 0 1 72 40" className="st-wifi" />
        <circle cx="44" cy="56" r="6" className="st-wifi-dot" />
        <path d="M6 66 L82 0" className="st-slash" />
      </g>
      <g transform="translate(60 326)">
        <rect width="440" height="44" rx="14" className="st-alert" />
        <text x="22" y="28" className="st-tag">
          Connection lost — your last changes were not saved
        </text>
      </g>
    </svg>
  );
}

/** 5. Late at night, searching for something better. */
export function SearchArt() {
  return (
    <svg
      {...svgProps('Searching for a whiteboard with voice for online classes')}
    >
      <Paper id="st-search" />
      <Window x={40} y={40} width={480} height={320} title="New tab" />
      <rect
        x="76"
        y="92"
        width="408"
        height="46"
        rx="23"
        className="st-field"
      />
      <circle cx="102" cy="114" r="8" className="st-ink-thin" />
      <path d="M108 120 l7 7" className="st-ink-thin" />
      <text x="124" y="120" className="st-type">
        whiteboard with voice for class
      </text>
      <rect x="430" y="102" width="2.5" height="24" className="st-caret" />
      {[168, 274].map((y) => (
        <g key={y}>
          <rect
            x="76"
            y={y}
            width="220"
            height="12"
            rx="6"
            className="st-bar"
          />
          <rect
            x="76"
            y={y + 22}
            width="340"
            height="10"
            rx="5"
            className="st-bar soft"
          />
        </g>
      ))}
      <g className="st-pick">
        <rect
          x="66"
          y="210"
          width="428"
          height="54"
          rx="14"
          className="st-result"
        />
        <rect x="80" y="222" width="30" height="30" rx="9" fill="#ff6b3d" />
        <path
          d="M87 243 C92 230 96 246 101 234 S106 238 104 230"
          stroke="#fff"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <text x="122" y="236" className="st-strong">
          CanvaRoom — live whiteboard
        </text>
        <text x="122" y="253" className="st-small">
          Voice + chat built in · free · no install
        </text>
      </g>
      <Cursor
        x={410}
        y={240}
        label="this one"
        color="#ff6b3d"
        className="st-bob"
      />
    </svg>
  );
}

/** 6. One link, no download. */
export function LandArt() {
  return (
    <svg {...svgProps('Creating a board and copying one invite link')}>
      <Paper id="st-land" />
      <Window
        x={40}
        y={40}
        width={480}
        height={300}
        title="canva-room-blush.vercel.app"
      />
      <rect
        x="80"
        y="100"
        width="160"
        height="110"
        rx="14"
        className="st-tile"
      />
      <path
        d="M100 180 C120 130 150 190 180 140 S220 150 222 126"
        className="st-ink-thin"
      />
      <text x="96" y="232" className="st-strong">
        Algebra — week 3
      </text>
      <g transform="translate(270 104)">
        <rect width="210" height="44" rx="22" className="st-cta" />
        <text x="105" y="28" textAnchor="middle" className="st-cta-text">
          + New board
        </text>
      </g>
      <g transform="translate(270 168)">
        <rect width="210" height="40" rx="12" className="st-field" />
        <text x="16" y="25" className="st-small">
          …/invite/7fK2q
        </text>
        <rect x="134" y="8" width="66" height="24" rx="12" className="st-ok" />
        <text x="167" y="24.5" textAnchor="middle" className="st-tag">
          Copied
        </text>
      </g>
      <Sticky
        x={330}
        y={236}
        lines={['0 installs', 'just a link']}
        rotate={5}
        width={128}
      />
      <Sticky
        x={84}
        y={262}
        lines={['free']}
        rotate={-6}
        color="#ffc9a8"
        width={84}
      />
    </svg>
  );
}

/** 7. The first live class: everyone draws, talks, and sees it instantly. */
export function LiveArt() {
  return (
    <svg
      {...svgProps(
        'Four people drawing on one board at the same time while talking',
      )}
    >
      <Paper id="st-live" />
      <g transform="translate(30 26)">
        {['Page 1', 'Page 2', 'Practice'].map((name, index) => (
          <g key={name} transform={`translate(${index * 92} 0)`}>
            <rect
              width="84"
              height="28"
              rx="10"
              className={index === 0 ? 'st-chip on' : 'st-chip'}
            />
            <text x="42" y="18.5" textAnchor="middle" className="st-small">
              {name}
            </text>
          </g>
        ))}
        <text x="290" y="19" className="st-small">
          +
        </text>
      </g>
      <g transform="translate(404 24)">
        <rect width="128" height="32" rx="16" className="st-chip" />
        <circle cx="20" cy="16" r="7" fill="#2f9e44" className="st-pulse" />
        <text x="36" y="21" className="st-strong">
          4 in voice
        </text>
      </g>
      <path d="M70 300 L180 110 L290 300 Z" className="st-ink" />
      <path d="M180 110 L180 300" className="st-ink-thin st-dash" />
      <path
        d="M318 230 C350 196 380 200 410 168"
        stroke="#ff6b3d"
        className="st-stroke st-draw"
      />
      <path
        d="M110 334 C150 350 210 350 252 330"
        stroke="#3b5bdb"
        className="st-stroke st-draw delay"
      />
      <path
        d="M440 260 l30 30 M470 260 l-30 30"
        stroke="#2f9e44"
        className="st-stroke"
      />
      <Cursor x={410} y={168} label="Sam" color="#ff6b3d" />
      <Cursor x={252} y={330} label="Ava" color="#3b5bdb" />
      <Cursor x={470} y={290} label="Leo" color="#2f9e44" />
      <Cursor x={84} y={130} label="Zoe" color="#ae3ec9" className="st-bob" />
      <Bubble x={300} y={86} text="ohh, NOW I get it" tone="accent" />
      <g transform="translate(36 352)">
        <rect width="110" height="26" rx="13" className="st-ok" />
        <text x="55" y="17.5" textAnchor="middle" className="st-tag">
          ~85 ms live
        </text>
      </g>
    </svg>
  );
}

/** 8. The Wi-Fi drops again, and nothing is lost. */
export function RecoverArt() {
  return (
    <svg {...svgProps('The board reconnects on its own and catches up')}>
      <Paper id="st-recover" />
      <path d="M70 290 L180 110 L290 300 Z" className="st-ink" />
      <path
        d="M318 230 C350 196 380 200 410 168"
        stroke="#ff6b3d"
        className="st-stroke"
      />
      <Sticky
        x={350}
        y={240}
        lines={['Area =', '½ × b × h']}
        rotate={4}
        width={140}
      />
      <g transform="translate(380 54)">
        <path d="M0 26 A44 44 0 0 1 88 26" className="st-wifi on st-arc1" />
        <path d="M16 40 A26 26 0 0 1 72 40" className="st-wifi on st-arc2" />
        <circle cx="44" cy="56" r="6" className="st-wifi-dot on" />
      </g>
      <g transform="translate(60 326)">
        <rect width="300" height="44" rx="14" className="st-ok" />
        <path
          d="M22 22 l7 7 l13 -14"
          stroke="#fff"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text x="54" y="28" className="st-tag">
          Back online · all caught up
        </text>
      </g>
      <g transform="translate(60 40)">
        <rect width="196" height="32" rx="16" className="st-chip" />
        <circle cx="20" cy="16" r="7" fill="#2f9e44" className="st-pulse" />
        <text x="36" y="21" className="st-strong">
          Voice still connected
        </text>
      </g>
    </svg>
  );
}

/** 9. A board full of everyone’s work. */
export function OutcomeArt() {
  return (
    <svg
      {...svgProps('A finished board covered in everyone’s notes and drawings')}
    >
      <Paper id="st-outcome" />
      <path d="M60 220 L140 80 L220 220 Z" className="st-ink" />
      <path
        d="M250 150 C280 100 330 110 350 150 S410 200 440 140"
        stroke="#3b5bdb"
        className="st-stroke"
      />
      <path
        d="M260 230 l40 -40 l30 30 l50 -60"
        stroke="#2f9e44"
        className="st-stroke"
      />
      <Sticky
        x={60}
        y={250}
        lines={['Got it!', '— Ava']}
        rotate={-5}
        width={112}
      />
      <Sticky
        x={196}
        y={262}
        lines={['Homework', 'p. 42, Q3']}
        rotate={3}
        color="#a5d8ff"
        width={128}
      />
      <Sticky
        x={350}
        y={240}
        lines={['Next class:', 'quadratics']}
        rotate={-2}
        color="#b2f2bb"
        width={140}
      />
      <g transform="translate(372 40)">
        <rect width="154" height="34" rx="17" className="st-chip" />
        <rect x="16" y="10" width="20" height="15" rx="3" className="st-cam" />
        <circle cx="26" cy="17.5" r="4" className="st-cam-lens" />
        <text x="46" y="22" className="st-strong">
          Snapshot saved
        </text>
      </g>
      <path
        d="M470 120 l10 -18 M492 132 l18 -8 M478 150 l14 10"
        className="st-spark"
      />
    </svg>
  );
}
