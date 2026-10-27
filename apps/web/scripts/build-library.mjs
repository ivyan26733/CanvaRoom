// Builds the board library: every pack's items as standalone SVG files plus a
// manifest, under public/library/v<version>/. Formulas are typeset here with
// MathJax (a dev dependency), so browsers only ever download finished SVGs.
//
//   node scripts/build-library.mjs
//
// Bump VERSION whenever published files change: the files are cached forever.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import {
  algebra,
  differentialEquations,
  differentiation,
  integration,
  statistics,
  trigonometry,
} from './library/maths.mjs';
import { geometry, physics, symbols, templates } from './library/science.mjs';
import {
  formulaTables,
  multiplicationTables,
  numberRules,
  vectors,
} from './library/tables.mjs';
import { CATEGORIES, ELEMENTS, position } from './library/elements.mjs';

export const VERSION = 1;
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'library',
  `v${VERSION}`,
);

const INK = '#1f2328';
const MUTED = '#6a6f78';
const RULE = '#c9cdd3';
const FONT =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
const PAD = 22;
const EM = 26; // Pixels per em for typeset formulas.

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
// One glyph cache per item: each file carries the glyphs it uses once.
const svgOutput = new SVG({ fontCache: 'global' });
const doc = mathjax.document('', { InputJax: tex, OutputJax: svgOutput });

const esc = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const r1 = (value) => Math.round(value * 10) / 10;

/** Typesets TeX; returns its size in pixels and a placer for nested SVG. */
function math(source, em = EM) {
  const node = doc.convert(source, { display: true });
  const markup = adaptor.innerHTML(node);
  if (/merror|data-mjx-error/.test(markup))
    throw new Error(`TeX error in: ${source}`);
  const svg = markup.match(/<svg[\s\S]*<\/svg>/)[0];
  const [, , vw, vh] = svg
    .match(/viewBox="([^"]+)"/)[1]
    .split(' ')
    .map(Number);
  const [minX, minY] = svg
    .match(/viewBox="([^"]+)"/)[1]
    .split(' ')
    .map(Number);
  const inner = svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/ data-[a-z-]+="[^"]*"/g, '');
  const width = (vw / 1000) * em;
  const height = (vh / 1000) * em;
  return {
    width,
    height,
    at: (x, y) =>
      `<svg x="${r1(x)}" y="${r1(y)}" width="${r1(width)}" height="${r1(height)}" viewBox="${minX} ${minY} ${vw} ${vh}" overflow="visible">${inner}</svg>`,
  };
}

const textWidth = (text, size, bold = false) =>
  [...String(text)].length * size * (bold ? 0.6 : 0.55);
const text = (
  x,
  y,
  value,
  size,
  { weight = 400, fill = INK, anchor = 'start' } = {},
) =>
  `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" font-family="${FONT}">${esc(value)}</text>`;

function wrap(title, width, height, body) {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const glyphs = adaptor
    .innerHTML(svgOutput.fontCache.defs)
    .replace(/ data-[a-z-]+="[^"]*"/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" color="${INK}"><title>${esc(title)}</title>${glyphs ? `<defs>${glyphs}</defs>` : ''}${body}</svg>`;
}

/** A caption in the pack's colour above the content. */
function caption(item, pack) {
  return {
    height: 30,
    width: textWidth(item.title, 15, true),
    draw: (x, y) =>
      text(x, y + 15, item.title, 15, { weight: 650, fill: pack.color }),
  };
}

// ---- Diagrams ----

const line = (x1, y1, x2, y2, extra = '') =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor"${extra.includes('stroke-width') ? '' : ' stroke-width="2"'} stroke-linecap="round"${extra}/>`;
const dashed = ' stroke-dasharray="6 5"';
const label = (source, cx, cy, em = 20) => {
  const m = math(source, em);
  return m.at(cx - m.width / 2, cy - m.height / 2);
};

const shapeDiagrams = {
  rightTriangle: () => ({
    width: 170,
    height: 140,
    svg:
      `<path d="M20 120 L150 120 L20 20 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M20 106 H34 V120" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      label('a', 8, 70) +
      label('b', 85, 134) +
      label('c', 96, 60),
  }),
  triangle: () => ({
    width: 170,
    height: 140,
    svg:
      `<path d="M15 120 L155 120 L60 20 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>` +
      line(60, 20, 60, 120, dashed) +
      label('h', 70, 75) +
      label('b', 85, 134),
  }),
  rectangle: () => ({
    width: 170,
    height: 130,
    svg:
      `<rect x="20" y="20" width="130" height="80" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      label('l', 85, 114) +
      label('b', 162, 60),
  }),
  trapezium: () => ({
    width: 170,
    height: 140,
    svg:
      `<path d="M50 30 L120 30 L155 115 L15 115 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>` +
      line(85, 30, 85, 115, dashed) +
      label('a', 85, 16) +
      label('b', 85, 130) +
      label('h', 96, 75),
  }),
  circle: () => ({
    width: 150,
    height: 140,
    svg:
      `<circle cx="72" cy="70" r="58" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      `<circle cx="72" cy="70" r="3" fill="currentColor"/>` +
      line(72, 70, 130, 70) +
      label('r', 101, 58),
  }),
  cuboid: () => ({
    width: 180,
    height: 140,
    svg:
      `<path d="M20 50 L120 50 L120 120 L20 120 Z M20 50 L55 20 L155 20 L120 50 M155 20 L155 90 L120 120" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M20 120 L55 90 L155 90 M55 90 L55 20" fill="none" stroke="currentColor" stroke-width="1.5"${dashed}/>` +
      label('l', 70, 134) +
      label('b', 150, 112) +
      label('h', 8, 86),
  }),
  cylinder: () => ({
    width: 150,
    height: 160,
    svg:
      `<ellipse cx="70" cy="28" rx="52" ry="14" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      `<path d="M18 28 V128 A52 14 0 0 0 122 128 V28" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      `<path d="M18 128 A52 14 0 0 1 122 128" fill="none" stroke="currentColor" stroke-width="1.5"${dashed}/>` +
      line(70, 28, 122, 28) +
      label('r', 96, 37, 18) +
      label('h', 136, 80),
  }),
  cone: () => ({
    width: 150,
    height: 166,
    svg:
      `<path d="M18 128 L70 18 L122 128" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<path d="M18 128 A52 14 0 0 0 122 128" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      `<path d="M18 128 A52 14 0 0 1 122 128" fill="none" stroke="currentColor" stroke-width="1.5"${dashed}/>` +
      line(70, 18, 70, 128, dashed) +
      line(70, 128, 122, 128) +
      label('h', 60, 80) +
      label('r', 96, 152) +
      label('l', 108, 66),
  }),
  sphere: () => ({
    width: 150,
    height: 140,
    svg:
      `<circle cx="72" cy="70" r="58" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      `<path d="M14 70 A58 16 0 0 0 130 70" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      `<path d="M14 70 A58 16 0 0 1 130 70" fill="none" stroke="currentColor" stroke-width="1.5"${dashed}/>` +
      `<circle cx="72" cy="70" r="3" fill="currentColor"/>` +
      line(72, 70, 116, 32) +
      label('r', 90, 42),
  }),
  // ---- Vectors ----
  vectorTriangle: () => ({
    width: 210,
    height: 150,
    svg:
      vector(20, 125, 120, 125) +
      vector(120, 125, 185, 30) +
      vector(20, 125, 185, 30, ' stroke-dasharray="7 5"') +
      label('\\vec a', 70, 140) +
      label('\\vec b', 170, 85) +
      label('\\vec a + \\vec b', 78, 62, 17),
  }),
  dotAngle: () => ({
    width: 200,
    height: 140,
    svg:
      vector(25, 115, 180, 115) +
      vector(25, 115, 120, 25) +
      `<path d="M70 115 A45 45 0 0 0 58 84" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
      line(120, 25, 120, 115, dashed + ' stroke-width="1.5"') +
      label('\\theta', 82, 100, 17) +
      label('\\vec a', 165, 130) +
      label('\\vec b', 62, 58) +
      label('|\\vec b|\\cos\\theta', 75, 130, 13),
  }),
  crossRight: () => ({
    width: 190,
    height: 170,
    svg:
      vector(60, 120, 170, 120) +
      vector(60, 120, 15, 160) +
      vector(60, 120, 60, 18) +
      `<path d="M60 102 L76 102 L76 120" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
      label('\\vec a', 160, 136) +
      label('\\vec b', 18, 128) +
      label('\\vec a\\times\\vec b', 108, 30, 17),
  }),
  axes3d: () => ({
    width: 190,
    height: 170,
    svg:
      vector(70, 110, 180, 110) +
      vector(70, 110, 70, 15) +
      vector(70, 110, 18, 160) +
      label('x', 8, 146, 17) +
      label('y', 172, 126, 17) +
      label('z', 84, 20, 17) +
      label('\\hat\\imath', 34, 122, 16) +
      label('\\hat\\jmath', 128, 98, 16) +
      label('\\hat k', 56, 60, 16),
  }),
};

const arrowHead = (x, y, angle) => {
  const a = (angle * Math.PI) / 180;
  const p = (dx, dy) =>
    `${r1(x + dx * Math.cos(a) - dy * Math.sin(a))} ${r1(y + dx * Math.sin(a) + dy * Math.cos(a))}`;
  return `<path d="M${p(-12, -6)} L${x} ${y} L${p(-12, 6)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
};

/** A line from (x1, y1) with an arrowhead at (x2, y2). */
const vector = (x1, y1, x2, y2, extra = '') =>
  line(x1, y1, x2, y2, ' stroke-width="2.5"' + extra) +
  arrowHead(x2, y2, (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);

const largeDiagrams = {
  unitCircle() {
    const size = 760;
    const c = size / 2;
    const R = 255;
    let svg =
      line(30, c, size - 30, c, ' stroke-width="1.5"') +
      line(c, size - 30, c, 30, ' stroke-width="1.5"') +
      arrowHead(size - 30, c, 0) +
      arrowHead(c, 30, -90) +
      `<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="currentColor" stroke-width="2.5"/>` +
      label('x', size - 22, c + 18, 18) +
      label('y', c + 16, 26, 18);
    const radians = {
      0: '0',
      30: '\\tfrac{\\pi}{6}',
      45: '\\tfrac{\\pi}{4}',
      60: '\\tfrac{\\pi}{3}',
      90: '\\tfrac{\\pi}{2}',
      120: '\\tfrac{2\\pi}{3}',
      135: '\\tfrac{3\\pi}{4}',
      150: '\\tfrac{5\\pi}{6}',
      180: '\\pi',
      210: '\\tfrac{7\\pi}{6}',
      225: '\\tfrac{5\\pi}{4}',
      240: '\\tfrac{4\\pi}{3}',
      270: '\\tfrac{3\\pi}{2}',
      300: '\\tfrac{5\\pi}{3}',
      315: '\\tfrac{7\\pi}{4}',
      330: '\\tfrac{11\\pi}{6}',
    };
    const coords = {
      0: '(1,\\,0)',
      30: '\\left(\\tfrac{\\sqrt{3}}{2},\\,\\tfrac{1}{2}\\right)',
      45: '\\left(\\tfrac{\\sqrt{2}}{2},\\,\\tfrac{\\sqrt{2}}{2}\\right)',
      60: '\\left(\\tfrac{1}{2},\\,\\tfrac{\\sqrt{3}}{2}\\right)',
      90: '(0,\\,1)',
      180: '(-1,\\,0)',
      270: '(0,\\,-1)',
    };
    for (const [deg, rad] of Object.entries(radians)) {
      const a = (Number(deg) * Math.PI) / 180;
      const x = c + R * Math.cos(a);
      const y = c - R * Math.sin(a);
      svg += line(c, c, x, y, ' stroke-width="1" stroke-opacity="0.35"');
      svg += `<circle cx="${r1(x)}" cy="${r1(y)}" r="5" fill="currentColor"/>`;
      const lx = c + (R + 44) * Math.cos(a);
      const ly = c - (R + 44) * Math.sin(a);
      // Labels on the vertical axis sit beside it rather than across it.
      const sx = deg === '90' || deg === '270' ? 24 : 0;
      svg += label(`${deg}^\\circ`, lx + sx, ly - 10, 15);
      svg += label(rad, lx + sx, ly + 11, 15);
      if (coords[deg]) {
        const inside = Number(deg) % 90 !== 0;
        const cx = inside
          ? c + (R - 66) * Math.cos(a)
          : x + (deg === '0' ? -34 : deg === '180' ? 38 : 40);
        const cy = inside
          ? c - (R - 66) * Math.sin(a)
          : y + (deg === '90' ? 22 : deg === '270' ? -22 : -16);
        svg += label(coords[deg], cx, cy, 14);
      }
    }
    return { width: size, height: size, svg };
  },
  astc() {
    const w = 420;
    const h = 360;
    const cx = w / 2;
    const cy = h / 2 + 10;
    const box = (x, y, letter, line1, range) =>
      text(x, y, letter, 44, { weight: 700, anchor: 'middle' }) +
      text(x, y + 26, line1, 15, { anchor: 'middle', fill: MUTED }) +
      label(range, x, y + 50, 15);
    return {
      width: w,
      height: h,
      svg:
        line(20, cy, w - 20, cy) +
        line(cx, h - 10, cx, 30) +
        arrowHead(w - 20, cy, 0) +
        arrowHead(cx, 30, -90) +
        box(
          cx + 100,
          cy - 90,
          'A',
          'All positive',
          '0^\\circ\\!-\\!90^\\circ',
        ) +
        box(
          cx - 100,
          cy - 90,
          'S',
          'sin, csc positive',
          '90^\\circ\\!-\\!180^\\circ',
        ) +
        box(
          cx - 100,
          cy + 60,
          'T',
          'tan, cot positive',
          '180^\\circ\\!-\\!270^\\circ',
        ) +
        box(
          cx + 100,
          cy + 60,
          'C',
          'cos, sec positive',
          '270^\\circ\\!-\\!360^\\circ',
        ),
    };
  },
  axes() {
    const unit = 32;
    const n = 8;
    const size = unit * n * 2 + 80;
    const c = size / 2;
    let svg = '';
    for (let i = -n; i <= n; i++) {
      const p = c + i * unit;
      svg += `<line x1="${p}" y1="${c - n * unit}" x2="${p}" y2="${c + n * unit}" stroke="${RULE}" stroke-width="1"/>`;
      svg += `<line x1="${c - n * unit}" y1="${p}" x2="${c + n * unit}" y2="${p}" stroke="${RULE}" stroke-width="1"/>`;
      if (i !== 0) {
        const n = i < 0 ? `−${-i}` : String(i);
        const m = -i < 0 ? `−${i}` : String(-i);
        svg += text(p, c + 18, n, 12, { anchor: 'middle', fill: MUTED });
        svg += text(c - 8, c + i * unit + 4, m, 12, {
          anchor: 'end',
          fill: MUTED,
        });
      }
    }
    svg +=
      line(c - n * unit - 24, c, c + n * unit + 24, c) +
      line(c, c + n * unit + 24, c, c - n * unit - 24) +
      arrowHead(c + n * unit + 24, c, 0) +
      arrowHead(c - n * unit - 24, c, 180) +
      arrowHead(c, c - n * unit - 24, -90) +
      arrowHead(c, c + n * unit + 24, 90) +
      label('x', c + n * unit + 22, c + 20, 20) +
      label('y', c + 18, c - n * unit - 22, 20) +
      text(c - 8, c + 18, 'O', 13, { anchor: 'end', fill: MUTED });
    return { width: size, height: size, svg };
  },
  graphPaper() {
    const step = 16;
    const cols = 40;
    const rows = 30;
    const w = cols * step;
    const h = rows * step;
    let svg = '';
    for (let i = 0; i <= cols; i++)
      svg += `<line x1="${i * step}" y1="0" x2="${i * step}" y2="${h}" stroke="${i % 5 === 0 ? '#9aa4b2' : RULE}" stroke-width="${i % 5 === 0 ? 1.2 : 0.6}"/>`;
    for (let i = 0; i <= rows; i++)
      svg += `<line x1="0" y1="${i * step}" x2="${w}" y2="${i * step}" stroke="${i % 5 === 0 ? '#9aa4b2' : RULE}" stroke-width="${i % 5 === 0 ? 1.2 : 0.6}"/>`;
    return { width: w, height: h, svg };
  },
  numberLine() {
    const unit = 40;
    const n = 10;
    const w = unit * n * 2 + 80;
    const y = 40;
    let svg =
      line(16, y, w - 16, y) + arrowHead(w - 16, y, 0) + arrowHead(16, y, 180);
    for (let i = -n; i <= n; i++) {
      const x = w / 2 + i * unit;
      svg += line(x, y - (i === 0 ? 12 : 8), x, y + (i === 0 ? 12 : 8));
      svg += text(x, y + 32, i < 0 ? `−${-i}` : String(i), 15, {
        anchor: 'middle',
        weight: i === 0 ? 700 : 400,
      });
    }
    return { width: w, height: 84, svg };
  },
  venn2() {
    const w = 560;
    const h = 360;
    return {
      width: w,
      height: h,
      svg:
        `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="10" fill="none" stroke="currentColor" stroke-width="2"/>` +
        `<circle cx="215" cy="190" r="125" fill="#2d5bff" fill-opacity="0.08" stroke="#2d5bff" stroke-width="2.5"/>` +
        `<circle cx="345" cy="190" r="125" fill="#e8590c" fill-opacity="0.08" stroke="#e8590c" stroke-width="2.5"/>` +
        label('U', 34, 34, 22) +
        label('A', 150, 70, 24) +
        label('B', 410, 70, 24),
    };
  },
  venn3() {
    const w = 560;
    const h = 500;
    return {
      width: w,
      height: h,
      svg:
        `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="10" fill="none" stroke="currentColor" stroke-width="2"/>` +
        `<circle cx="210" cy="190" r="125" fill="#2d5bff" fill-opacity="0.07" stroke="#2d5bff" stroke-width="2.5"/>` +
        `<circle cx="350" cy="190" r="125" fill="#e8590c" fill-opacity="0.07" stroke="#e8590c" stroke-width="2.5"/>` +
        `<circle cx="280" cy="310" r="125" fill="#00a37a" fill-opacity="0.07" stroke="#00a37a" stroke-width="2.5"/>` +
        label('U', 34, 34, 22) +
        label('A', 120, 80, 24) +
        label('B', 440, 80, 24) +
        label('C', 280, 462, 24),
    };
  },
  protractor() {
    const R = 260;
    const w = R * 2 + 40;
    const h = R + 50;
    const cx = w / 2;
    const cy = R + 20;
    let svg =
      `<path d="M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy} Z" fill="#2d5bff" fill-opacity="0.05" stroke="currentColor" stroke-width="2.5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="4" fill="currentColor"/>` +
      line(cx, cy, cx, cy - 26, ' stroke-width="1.5"');
    for (let d = 0; d <= 180; d++) {
      const a = (d * Math.PI) / 180;
      const len = d % 10 === 0 ? 22 : d % 5 === 0 ? 15 : 8;
      const x1 = cx - R * Math.cos(a);
      const y1 = cy - R * Math.sin(a);
      const x2 = cx - (R - len) * Math.cos(a);
      const y2 = cy - (R - len) * Math.sin(a);
      svg += `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor" stroke-width="${d % 10 === 0 ? 1.6 : 1}"/>`;
      if (d % 10 === 0 && d % 180 !== 0) {
        const outer = cx - (R - 36) * Math.cos(a);
        const outerY = cy - (R - 36) * Math.sin(a) + 4;
        const inner = cx - (R - 58) * Math.cos(a);
        const innerY = cy - (R - 58) * Math.sin(a) + 4;
        svg += text(outer, outerY, String(d), 12, {
          anchor: 'middle',
          weight: 600,
        });
        svg += text(inner, innerY, String(180 - d), 11, {
          anchor: 'middle',
          fill: MUTED,
        });
      }
    }
    return { width: w, height: h, svg };
  },
  tableGrid() {
    const cols = 5;
    const rows = 7;
    const cw = 130;
    const rh = 44;
    const w = cols * cw + 4;
    const h = rows * rh + 4;
    let svg = `<rect x="2" y="2" width="${cols * cw}" height="${rh}" fill="#2d5bff" fill-opacity="0.08"/>`;
    for (let i = 0; i <= cols; i++)
      svg += `<line x1="${2 + i * cw}" y1="2" x2="${2 + i * cw}" y2="${2 + rows * rh}" stroke="currentColor" stroke-width="${i === 0 || i === cols ? 2 : 1.2}"/>`;
    for (let i = 0; i <= rows; i++)
      svg += `<line x1="2" y1="${2 + i * rh}" x2="${2 + cols * cw}" y2="${2 + i * rh}" stroke="currentColor" stroke-width="${i === 0 || i === rows || i === 1 ? 2 : 1.2}"/>`;
    return { width: w, height: h, svg };
  },
};

// ---- Item renderers ----

function renderFormula(item, pack) {
  const head = caption(item, pack);
  const lines = item.lines.map((line) => math(line));
  const gap = 12;
  const diagram = item.diagram ? shapeDiagrams[item.diagram]() : null;
  const mathWidth = Math.max(...lines.map((l) => l.width));
  const mathHeight =
    lines.reduce((sum, l) => sum + l.height, 0) + gap * (lines.length - 1);
  const left = diagram ? diagram.width + 18 : 0;
  const contentHeight = Math.max(mathHeight, diagram?.height ?? 0);
  const width = PAD * 2 + Math.max(head.width, left + mathWidth);
  const height = PAD * 2 + head.height + contentHeight;
  let body = head.draw(PAD, PAD);
  const top = PAD + head.height;
  if (diagram)
    body += `<g transform="translate(${PAD} ${r1(top + (contentHeight - diagram.height) / 2)})">${diagram.svg}</g>`;
  let y = top + (contentHeight - mathHeight) / 2;
  for (const l of lines) {
    body += l.at(PAD + left, y);
    y += l.height + gap;
  }
  return wrap(item.title, width, height, body);
}

const PLAIN = /^\\text\{([^{}\\]*)\}$/;
function cell(source, { header = false } = {}) {
  const plain = source.match(PLAIN);
  if (plain) {
    const size = 15;
    return {
      width: textWidth(plain[1], size, header),
      height: 20,
      at: (x, y, w, h) =>
        text(x + 0, y + h / 2 + 5, plain[1], size, {
          weight: header ? 650 : 400,
          fill: header ? INK : INK,
        }),
    };
  }
  const m = math(source, 22);
  return {
    width: m.width,
    height: m.height,
    at: (x, y, w, h) => m.at(x, y + (h - m.height) / 2),
  };
}

function renderTable(item, pack) {
  const head = caption(item, pack);
  const grid = [
    item.header.map((source) => cell(source, { header: true })),
    ...item.rows.map((row) => row.map((source) => cell(source))),
  ];
  const cols = item.header.length;
  const padX = 12;
  const padY = 8;
  const colWidths = [...Array(cols)].map(
    (_, c) => Math.max(...grid.map((row) => row[c].width)) + padX * 2,
  );
  const rowHeights = grid.map(
    (row) => Math.max(28, ...row.map((entry) => entry.height)) + padY * 2,
  );
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const tableHeight = rowHeights.reduce((a, b) => a + b, 0);
  const width = PAD * 2 + Math.max(head.width, tableWidth);
  const height = PAD * 2 + head.height + tableHeight;
  const x0 = PAD;
  const y0 = PAD + head.height;
  let body =
    head.draw(PAD, PAD) +
    `<rect x="${x0}" y="${y0}" width="${r1(tableWidth)}" height="${r1(rowHeights[0])}" fill="${pack.color}" fill-opacity="0.1"/>`;
  let y = y0;
  grid.forEach((row, r) => {
    let x = x0;
    row.forEach((entry, c) => {
      body += entry.at(
        x + padX,
        y + padY,
        colWidths[c] - padX * 2,
        rowHeights[r] - padY * 2,
      );
      x += colWidths[c];
    });
    y += rowHeights[r];
  });
  // Rules: outer frame, a heavier line under the header, light lines between.
  y = y0;
  rowHeights.forEach((rh, r) => {
    y += rh;
    if (r < rowHeights.length - 1)
      body += `<line x1="${x0}" y1="${r1(y)}" x2="${r1(x0 + tableWidth)}" y2="${r1(y)}" stroke="${r === 0 ? INK : RULE}" stroke-width="${r === 0 ? 1.5 : 1}"/>`;
  });
  let x = x0;
  colWidths.slice(0, -1).forEach((cw) => {
    x += cw;
    body += `<line x1="${r1(x)}" y1="${y0}" x2="${r1(x)}" y2="${r1(y0 + tableHeight)}" stroke="${RULE}" stroke-width="1"/>`;
  });
  body += `<rect x="${x0}" y="${y0}" width="${r1(tableWidth)}" height="${r1(tableHeight)}" rx="4" fill="none" stroke="${INK}" stroke-width="1.5"/>`;
  return wrap(item.title, width, height, body);
}

function renderSymbol(item) {
  const m = math(`\\textstyle ${item.tex}`, 56);
  const pad = 10;
  return wrap(
    item.title,
    m.width + pad * 2,
    m.height + pad * 2,
    m.at(pad, pad),
  );
}

function renderDiagram(item, pack) {
  const head = caption(item, pack);
  const d = largeDiagrams[item.draw]();
  const width = PAD * 2 + Math.max(head.width, d.width);
  const height = PAD * 2 + head.height + d.height;
  const body =
    head.draw(PAD, PAD) +
    `<g transform="translate(${r1(PAD + (width - PAD * 2 - d.width) / 2)} ${PAD + head.height})">${d.svg}</g>`;
  return wrap(item.title, width, height, body);
}

// ---- Periodic table ----

function tile(element, x, y, w, h) {
  const fill = CATEGORIES[element.category].fill;
  return (
    `<rect x="${r1(x + 1.5)}" y="${r1(y + 1.5)}" width="${w - 3}" height="${h - 3}" rx="5" fill="${fill}" stroke="#495057" stroke-width="0.8"/>` +
    text(x + 6, y + 14, String(element.number), 10.5, {
      weight: 600,
      fill: '#343a40',
    }) +
    text(x + w / 2, y + h / 2 + 7, element.symbol, 22, {
      weight: 700,
      anchor: 'middle',
      fill: '#111',
    }) +
    text(
      x + w / 2,
      y + h - 17,
      element.name,
      element.name.length > 11 ? 7.2 : 8.5,
      { anchor: 'middle', fill: '#343a40' },
    ) +
    text(x + w / 2, y + h - 6, element.mass, 8.5, {
      anchor: 'middle',
      fill: '#495057',
    })
  );
}

function periodicTable(pack) {
  const w = 66;
  const h = 76;
  const left = 46;
  const top = 74;
  let body = text(PAD, PAD + 22, 'Periodic table of the elements', 24, {
    weight: 700,
    fill: pack.color,
  });
  for (let g = 1; g <= 18; g++)
    body += text(left + (g - 0.5) * w, top - 8, String(g), 11, {
      anchor: 'middle',
      fill: MUTED,
      weight: 600,
    });
  for (let p = 1; p <= 7; p++)
    body += text(left - 12, top + (p - 0.5) * h + 4, String(p), 11, {
      anchor: 'middle',
      fill: MUTED,
      weight: 600,
    });
  for (const element of ELEMENTS) {
    const { row, col } = position(element.number);
    const y = row >= 9 ? top + (row - 1.5) * h + 12 : top + (row - 1) * h;
    body += tile(element, left + (col - 1) * w, y, w, h);
  }
  // Where the f-block rows belong.
  for (const [row, range] of [
    [6, '57–71'],
    [7, '89–103'],
  ]) {
    const x = left + 2 * w;
    const y = top + (row - 1) * h;
    body += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="5" fill="none" stroke="#868e96" stroke-width="0.8" stroke-dasharray="4 3"/>`;
    body += text(x + w / 2, y + h / 2 + 4, range, 11, {
      anchor: 'middle',
      fill: MUTED,
      weight: 600,
    });
  }
  // Legend in the gap above the transition metals.
  const legendX = left + 2.4 * w;
  const legendY = top + 4;
  Object.values(CATEGORIES).forEach((category, index) => {
    const col = Math.floor(index / 4);
    const row = index % 4;
    const x = legendX + col * 205;
    const y = legendY + row * 22;
    body += `<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${category.fill}" stroke="#495057" stroke-width="0.8"/>`;
    body += text(x + 20, y + 11.5, category.label, 12, { fill: '#343a40' });
  });
  const width = left + 18 * w + PAD;
  const height = top + 9.5 * h + 12 + 40;
  body += text(
    left,
    height - 14,
    'Standard atomic weights (abridged). [n] = mass number of the most stable isotope.',
    11,
    { fill: MUTED },
  );
  return wrap('Periodic table', width, height, body);
}

function firstTwenty(pack) {
  const w = 96;
  const h = 104;
  const cols = 5;
  let body = text(PAD, PAD + 18, 'First 20 elements', 18, {
    weight: 700,
    fill: pack.color,
  });
  ELEMENTS.slice(0, 20).forEach((element, index) => {
    const x = PAD + (index % cols) * w;
    const y = PAD + 34 + Math.floor(index / cols) * h;
    body +=
      `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="7" fill="${CATEGORIES[element.category].fill}" stroke="#495057" stroke-width="0.9"/>` +
      text(x + 9, y + 18, String(element.number), 13, {
        weight: 600,
        fill: '#343a40',
      }) +
      text(x + w / 2, y + 58, element.symbol, 32, {
        weight: 700,
        anchor: 'middle',
        fill: '#111',
      }) +
      text(x + w / 2, y + 78, element.name, 11, {
        anchor: 'middle',
        fill: '#343a40',
      }) +
      text(x + w / 2, y + 93, element.mass, 11, {
        anchor: 'middle',
        fill: '#495057',
      });
  });
  return wrap(
    'First 20 elements',
    PAD * 2 + cols * w,
    PAD * 2 + 34 + 4 * h,
    body,
  );
}

const periodic = {
  id: 'periodic-table',
  title: 'Periodic table',
  subject: 'Chemistry',
  description:
    'All 118 elements with atomic number, symbol, name, atomic mass, and category colours.',
  glyph: 'Fe',
  color: '#2b8a3e',
  items: [
    {
      type: 'custom',
      id: 'periodic-table',
      title: 'Periodic table',
      keywords: 'elements chemistry full',
      render: periodicTable,
    },
    {
      type: 'custom',
      id: 'first-20',
      title: 'First 20 elements',
      keywords: 'elements chemistry hydrogen calcium',
      render: firstTwenty,
    },
  ],
};

// ---- Build ----

const PACKS = [
  trigonometry,
  algebra,
  numberRules,
  multiplicationTables,
  differentiation,
  integration,
  differentialEquations,
  vectors,
  geometry,
  formulaTables,
  statistics,
  periodic,
  physics,
  symbols,
  templates,
];

function render(item, pack) {
  svgOutput.fontCache.clearCache();
  switch (item.type) {
    case 'formula':
      return renderFormula(item, pack);
    case 'table':
      return renderTable(item, pack);
    case 'symbol':
      return renderSymbol(item);
    case 'diagram':
      return renderDiagram(item, pack);
    case 'custom':
      return item.render(pack);
  }
  throw new Error(`Unknown item type ${item.type}`);
}

const ID = /^[a-z0-9-]{1,60}$/;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = { version: VERSION, packs: [] };
for (const pack of PACKS) {
  if (!ID.test(pack.id)) throw new Error(`Bad pack id ${pack.id}`);
  mkdirSync(join(OUT, pack.id), { recursive: true });
  const items = [];
  let bytes = 0;
  const seen = new Set();
  for (const item of pack.items) {
    if (!ID.test(item.id) || seen.has(item.id))
      throw new Error(`Bad or duplicate item id ${pack.id}/${item.id}`);
    seen.add(item.id);
    const svg = render(item, pack);
    for (const tag of svg.match(/<[a-zA-Z][^>]*>/g)) {
      const names = [...tag.matchAll(/\s([a-zA-Z:-]+)="/g)].map((m) => m[1]);
      if (new Set(names).size !== names.length)
        throw new Error(`Repeated attribute in ${pack.id}/${item.id}: ${tag}`);
    }
    if (
      /<script|\son[a-z]+=|href="[^#]|javascript:|<foreignObject|<image/i.test(
        svg,
      )
    )
      throw new Error(`Unsafe markup in ${pack.id}/${item.id}`);
    const [, width, height] = svg.match(
      /^<svg[^>]* width="(\d+)" height="(\d+)"/,
    );
    writeFileSync(join(OUT, pack.id, `${item.id}.svg`), svg);
    bytes += Buffer.byteLength(svg);
    items.push({
      id: item.id,
      title: item.title,
      keywords: item.keywords ?? '',
      width: Number(width),
      height: Number(height),
    });
  }
  const packJson = JSON.stringify({ id: pack.id, version: VERSION, items });
  writeFileSync(join(OUT, pack.id, 'pack.json'), packJson);
  bytes += Buffer.byteLength(packJson);
  manifest.packs.push({
    id: pack.id,
    title: pack.title,
    subject: pack.subject,
    description: pack.description,
    glyph: pack.glyph,
    color: pack.color,
    items: items.length,
    bytes,
    preview: items.slice(0, 3).map((item) => item.id),
  });
  console.log(
    `${pack.id.padEnd(24)} ${String(items.length).padStart(3)} items  ${(bytes / 1024).toFixed(0).padStart(5)} KB`,
  );
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(manifest));
