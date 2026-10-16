export type TemplateId =
  'blank' | 'brainstorm' | 'flowchart' | 'kanban' | 'retro';

export const TEMPLATES: {
  id: TemplateId;
  name: string;
  blurb: string;
}[] = [
  { id: 'blank', name: 'Blank canvas', blurb: 'Start from nothing' },
  { id: 'brainstorm', name: 'Brainstorm', blurb: 'One question, many notes' },
  { id: 'flowchart', name: 'Flowchart', blurb: 'Steps and decisions' },
  { id: 'kanban', name: 'Kanban', blurb: 'To do, doing, done' },
  { id: 'retro', name: 'Retrospective', blurb: 'Look back, plan ahead' },
];

/** Small illustrations of each template. */
export function TemplateArt({ id }: { id: TemplateId }) {
  switch (id) {
    case 'blank':
      return (
        <svg viewBox="0 0 160 100" aria-hidden="true">
          <path
            d="M44 62c10-22 20-30 30-30 14 0 6 26 18 26 7 0 12-7 16-18"
            className="art-ink"
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle cx="112" cy="34" r="4" className="art-accent" />
        </svg>
      );
    case 'brainstorm':
      return (
        <svg viewBox="0 0 160 100" aria-hidden="true">
          <ellipse
            cx="80"
            cy="50"
            rx="24"
            ry="14"
            className="art-accent-soft"
          />
          {[
            [22, 12, '#ffe45c'],
            [68, 4, '#ffb4a2'],
            [114, 12, '#9be7c4'],
            [22, 66, '#a5c8ff'],
            [114, 66, '#d7b8ff'],
          ].map(([x, y, color]) => (
            <rect
              key={`${x}-${y}`}
              x={x as number}
              y={y as number}
              width="24"
              height="22"
              rx="3"
              fill={color as string}
            />
          ))}
        </svg>
      );
    case 'flowchart':
      return (
        <svg viewBox="0 0 160 100" aria-hidden="true">
          <rect
            x="20"
            y="38"
            width="34"
            height="24"
            rx="12"
            className="art-line"
          />
          <path d="M54 50h16" className="art-line" />
          <rect
            x="70"
            y="38"
            width="34"
            height="24"
            rx="4"
            className="art-line"
          />
          <path d="M104 50h12" className="art-line" />
          <path d="M128 36l12 14-12 14-12-14z" className="art-accent-line" />
        </svg>
      );
    case 'kanban':
      return (
        <svg viewBox="0 0 160 100" aria-hidden="true">
          {[18, 64, 110].map((x, column) => (
            <g key={x}>
              <rect
                x={x}
                y="12"
                width="34"
                height="76"
                rx="4"
                className="art-column"
              />
              {Array.from({ length: 3 - column }, (_, row) => (
                <rect
                  key={row}
                  x={x + 5}
                  y={22 + row * 22}
                  width="24"
                  height="16"
                  rx="2"
                  fill={['#ffe45c', '#a5c8ff', '#9be7c4'][(row + column) % 3]}
                />
              ))}
            </g>
          ))}
        </svg>
      );
    case 'retro':
      return (
        <svg viewBox="0 0 160 100" aria-hidden="true">
          {[
            [18, '#12a150'],
            [64, '#ff4f1f'],
            [110, '#7c4dff'],
          ].map(([x, color]) => (
            <g key={x as number}>
              <rect
                x={x as number}
                y="12"
                width="34"
                height="76"
                rx="4"
                fill={`${color}1a`}
                stroke={color as string}
                strokeWidth="1.5"
              />
              <rect
                x={(x as number) + 5}
                y="24"
                width="24"
                height="18"
                rx="2"
                fill="#ffe45c"
              />
            </g>
          ))}
        </svg>
      );
  }
}
