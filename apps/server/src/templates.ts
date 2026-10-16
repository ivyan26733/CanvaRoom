import { randomUUID } from 'node:crypto';
import type { BoardObject } from './models.js';

export const TEMPLATES = [
  'blank',
  'brainstorm',
  'flowchart',
  'kanban',
  'retro',
] as const;
export type Template = (typeof TEMPLATES)[number];

const INK = '#1b1b1b';
const STICKY = {
  yellow: '#ffe45c',
  peach: '#ffb4a2',
  mint: '#9be7c4',
  sky: '#a5c8ff',
  lilac: '#d7b8ff',
};

type Draft = Omit<BoardObject, 'id' | 'color' | 'strokeWidth'> &
  Partial<Pick<BoardObject, 'color' | 'strokeWidth'>>;

const text = (x: number, y: number, value: string, fontSize = 28): Draft => ({
  kind: 'text',
  x,
  y,
  text: value,
  fontSize,
});
const sticky = (
  x: number,
  y: number,
  value: string,
  color: string,
  size = 180,
): Draft => ({
  kind: 'sticky',
  x,
  y,
  width: size,
  height: size,
  text: value,
  color,
  strokeWidth: 1,
  fontSize: 18,
});
const box = (
  kind: 'rect' | 'ellipse' | 'diamond',
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<BoardObject> = {},
): Draft => ({ kind, x, y, width, height, ...extra });
const arrow = (x: number, y: number, dx: number, dy: number): Draft => ({
  kind: 'arrow',
  x,
  y,
  points: [0, 0, dx, dy],
});

function column(x: number, title: string, color: string, notes: string[]) {
  return [
    box('rect', x, 0, 300, 640, {
      color,
      fillColor: `${color}14`,
      strokeWidth: 2,
    }),
    text(x + 24, 24, title, 26),
    ...notes.map((note, index) =>
      sticky(x + 30, 96 + index * 200, note, Object.values(STICKY)[index % 5]!),
    ),
  ];
}

const builders: Record<Template, () => Draft[]> = {
  blank: () => [],
  brainstorm: () => [
    box('ellipse', -170, -90, 340, 180, {
      color: '#ff4f1f',
      fillColor: '#ff4f1f1a',
      strokeWidth: 3,
    }),
    text(-118, -22, 'The big question?', 30),
    sticky(-560, -380, 'What do we already know?', STICKY.yellow),
    sticky(-90, -420, 'Wild idea', STICKY.peach),
    sticky(380, -380, 'Who is this for?', STICKY.mint),
    sticky(-560, 200, 'What could go wrong?', STICKY.sky),
    sticky(-90, 240, 'Quick win', STICKY.lilac),
    sticky(380, 200, 'Next step', STICKY.yellow),
    arrow(-380, -210, 210, 150),
    arrow(0, -240, 0, 150),
    arrow(380, -210, -210, 150),
    arrow(-380, 210, 210, -130),
    arrow(0, 240, 0, -150),
    arrow(380, 210, -210, -130),
  ],
  flowchart: () => [
    box('ellipse', 0, 0, 200, 90, { color: '#12a150', strokeWidth: 3 }),
    text(68, 26, 'Start', 26),
    arrow(100, 90, 0, 90),
    box('rect', -20, 180, 240, 110, { color: '#2d5bff', strokeWidth: 3 }),
    text(26, 216, 'Do the thing', 26),
    arrow(100, 290, 0, 90),
    box('diamond', -20, 380, 240, 170, { color: '#f5a623', strokeWidth: 3 }),
    text(48, 445, 'Worked?', 26),
    arrow(220, 465, 160, 0),
    text(250, 425, 'yes', 20),
    box('rect', 380, 410, 220, 110, { color: '#12a150', strokeWidth: 3 }),
    text(440, 446, 'Ship it', 26),
    arrow(-20, 465, -160, 0),
    text(-110, 425, 'no', 20),
    box('rect', -400, 410, 220, 110, { color: '#e8458b', strokeWidth: 3 }),
    text(-362, 446, 'Try again', 26),
  ],
  kanban: () => [
    text(0, -90, 'Project board', 40),
    ...column(0, 'To do', '#2d5bff', ['Outline the plan', 'Book a room']),
    ...column(340, 'Doing', '#f5a623', ['Draft the slides']),
    ...column(680, 'Done', '#12a150', ['Pick a topic']),
  ],
  retro: () => [
    text(0, -90, 'Retrospective', 40),
    ...column(0, 'Went well', '#12a150', ['Shipped on time']),
    ...column(340, 'To improve', '#ff4f1f', ['Too many meetings']),
    ...column(680, 'Actions', '#7c4dff', ['Try async updates']),
  ],
};

export function templateObjects(template: Template): BoardObject[] {
  return builders[template]().map((draft) => ({
    color: INK,
    strokeWidth: 2,
    ...draft,
    id: randomUUID(),
    page: 'p1',
  }));
}
