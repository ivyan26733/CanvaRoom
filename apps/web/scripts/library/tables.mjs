// The vectors pack and the formula tables pack. Formula items are a caption
// plus TeX lines (optionally beside a small diagram); tables list a header row
// and body rows of TeX, where \text{…} cells are set as plain text.

const f = (id, title, lines, keywords = '', diagram) => ({
  type: 'formula',
  id,
  title,
  lines,
  keywords,
  ...(diagram ? { diagram } : {}),
});
const table = (id, title, header, rows, keywords = '') => ({
  type: 'table',
  id,
  title,
  header,
  rows,
  keywords,
});

const i = '\\hat\\imath';
const j = '\\hat\\jmath';
const k = '\\hat k';

export const vectors = {
  id: 'vectors',
  title: 'Vectors',
  subject: 'Maths',
  description:
    'Components, dot and cross products, unit-vector tables, triple products, and lines and planes in 3D.',
  glyph: 'a⃗',
  color: '#c2255c',
  items: [
    table(
      'unit-dot-table',
      'Dot products of unit vectors',
      ['\\cdot', i, j, k],
      [
        [i, '1', '0', '0'],
        [j, '0', '1', '0'],
        [k, '0', '0', '1'],
      ],
      'dot scalar product i j k table orthogonal',
    ),
    table(
      'unit-cross-table',
      'Cross products of unit vectors',
      ['\\times', i, j, k],
      [
        [i, '\\vec 0', k, `-${j}`],
        [j, `-${k}`, '\\vec 0', i],
        [k, j, `-${i}`, '\\vec 0'],
      ],
      'cross vector product i j k table cyclic',
    ),
    f(
      'components',
      'Components, magnitude and unit vector',
      [
        `\\vec r = x\\,${i} + y\\,${j} + z\\,${k}`,
        '|\\vec r| = \\sqrt{x^2 + y^2 + z^2}',
        '\\hat r = \\dfrac{\\vec r}{|\\vec r|}',
        '\\cos^2\\alpha + \\cos^2\\beta + \\cos^2\\gamma = 1',
      ],
      'position vector modulus direction cosines unit',
      'axes3d',
    ),
    f(
      'triangle-law',
      'Adding vectors (triangle law)',
      [
        '\\vec a + \\vec b = \\vec b + \\vec a',
        '|\\vec a + \\vec b|^2 = |\\vec a|^2 + |\\vec b|^2 + 2|\\vec a||\\vec b|\\cos\\theta',
        '|\\vec a + \\vec b| \\le |\\vec a| + |\\vec b|',
      ],
      'resultant addition parallelogram law triangle inequality',
      'vectorTriangle',
    ),
    f(
      'dot-product',
      'Dot (scalar) product',
      [
        '\\vec a\\cdot\\vec b = |\\vec a|\\,|\\vec b|\\cos\\theta = a_1b_1 + a_2b_2 + a_3b_3',
        '\\cos\\theta = \\dfrac{\\vec a\\cdot\\vec b}{|\\vec a|\\,|\\vec b|}',
        '\\text{projection of } \\vec b \\text{ on } \\vec a = \\dfrac{\\vec a\\cdot\\vec b}{|\\vec a|}',
        '\\vec a\\perp\\vec b \\iff \\vec a\\cdot\\vec b = 0',
      ],
      'scalar product angle between vectors projection perpendicular',
      'dotAngle',
    ),
    f(
      'cross-product',
      'Cross (vector) product',
      [
        '\\vec a\\times\\vec b = |\\vec a|\\,|\\vec b|\\sin\\theta\\;\\hat n',
        `\\vec a\\times\\vec b = \\begin{vmatrix} ${i} & ${j} & ${k} \\\\ a_1 & a_2 & a_3 \\\\ b_1 & b_2 & b_3 \\end{vmatrix}`,
        '\\text{area of parallelogram} = |\\vec a\\times\\vec b|',
        '\\vec a\\parallel\\vec b \\iff \\vec a\\times\\vec b = \\vec 0',
      ],
      'vector product determinant area parallel right hand rule',
      'crossRight',
    ),
    table(
      'dot-vs-cross',
      'Dot and cross products compared',
      ['\\text{Property}', '\\vec a\\cdot\\vec b', '\\vec a\\times\\vec b'],
      [
        ['\\text{Result}', '\\text{a scalar}', '\\text{a vector}'],
        [
          '\\text{Order}',
          '\\vec a\\cdot\\vec b = \\vec b\\cdot\\vec a',
          '\\vec a\\times\\vec b = -\\,\\vec b\\times\\vec a',
        ],
        ['\\text{Parallel}', '\\pm|\\vec a|\\,|\\vec b|', '\\vec 0'],
        ['\\text{Perpendicular}', '0', '|\\vec a|\\,|\\vec b|\\;\\hat n'],
        ['\\text{With itself}', '|\\vec a|^2', '\\vec 0'],
      ],
      'compare scalar vector product properties commutative',
    ),
    f(
      'triple-products',
      'Triple products',
      [
        '[\\vec a\\;\\vec b\\;\\vec c] = \\vec a\\cdot(\\vec b\\times\\vec c) = \\begin{vmatrix} a_1 & a_2 & a_3 \\\\ b_1 & b_2 & b_3 \\\\ c_1 & c_2 & c_3 \\end{vmatrix}',
        '\\text{volume of parallelepiped} = |[\\vec a\\;\\vec b\\;\\vec c]|',
        '\\vec a,\\ \\vec b,\\ \\vec c \\text{ coplanar} \\iff [\\vec a\\;\\vec b\\;\\vec c] = 0',
        '\\vec a\\times(\\vec b\\times\\vec c) = (\\vec a\\cdot\\vec c)\\,\\vec b - (\\vec a\\cdot\\vec b)\\,\\vec c',
      ],
      'scalar triple product box product vector triple coplanar volume',
    ),
    f(
      'section-formula',
      'Section formula',
      [
        '\\vec r = \\dfrac{m\\,\\vec b + n\\,\\vec a}{m + n} \\quad \\text{(internal, } m:n\\text{)}',
        '\\vec r = \\dfrac{m\\,\\vec b - n\\,\\vec a}{m - n} \\quad \\text{(external)}',
        '\\text{midpoint: } \\dfrac{\\vec a + \\vec b}{2} \\qquad \\text{centroid: } \\dfrac{\\vec a + \\vec b + \\vec c}{3}',
      ],
      'divide ratio midpoint centroid position vector',
    ),
    f(
      'lines-planes',
      'Lines and planes in 3D',
      [
        '\\text{line: } \\vec r = \\vec a + \\lambda\\,\\vec b',
        '\\text{plane: } \\vec r\\cdot\\hat n = d \\qquad ax + by + cz = d',
        '\\text{distance from a point to a plane} = \\dfrac{|\\vec a\\cdot\\vec n - d|}{|\\vec n|}',
        '\\text{shortest distance between skew lines} = \\dfrac{|(\\vec a_2 - \\vec a_1)\\cdot(\\vec b_1\\times\\vec b_2)|}{|\\vec b_1\\times\\vec b_2|}',
      ],
      'equation of line plane 3d geometry distance skew lines',
    ),
  ],
};

export const formulaTables = {
  id: 'formula-tables',
  title: 'Formula tables',
  subject: 'Maths',
  description:
    'Quick-reference tables: areas and volumes, derivatives with integrals, logs, identities, series, and squares and cubes.',
  glyph: '▦',
  color: '#5f3dc4',
  items: [
    table(
      'area-perimeter',
      'Area and perimeter of plane figures',
      ['\\text{Figure}', '\\text{Area}', '\\text{Perimeter}'],
      [
        ['\\text{Square}', 'a^2', '4a'],
        ['\\text{Rectangle}', 'l\\,b', '2(l + b)'],
        ['\\text{Triangle}', '\\tfrac12\\,b\\,h', 'a + b + c'],
        ['\\text{Triangle (Heron)}', '\\sqrt{s(s-a)(s-b)(s-c)}', '2s'],
        ['\\text{Equilateral triangle}', '\\tfrac{\\sqrt3}{4}\\,a^2', '3a'],
        ['\\text{Parallelogram}', 'b\\,h', '2(a + b)'],
        ['\\text{Rhombus}', '\\tfrac12\\,d_1 d_2', '4a'],
        ['\\text{Trapezium}', '\\tfrac12\\,(a + b)\\,h', 'a + b + c + d'],
        ['\\text{Circle}', '\\pi r^2', '2\\pi r'],
        [
          '\\text{Sector (angle θ)}',
          '\\tfrac{\\theta}{360^\\circ}\\,\\pi r^2',
          '2r + \\tfrac{\\theta}{360^\\circ}\\,2\\pi r',
        ],
      ],
      'mensuration area perimeter circumference shapes 2d',
    ),
    table(
      'surface-volume',
      'Surface area and volume of solids',
      [
        '\\text{Solid}',
        '\\text{Curved / lateral}',
        '\\text{Total surface}',
        '\\text{Volume}',
      ],
      [
        ['\\text{Cube}', '4a^2', '6a^2', 'a^3'],
        ['\\text{Cuboid}', '2h(l + b)', '2(lb + bh + hl)', 'l\\,b\\,h'],
        ['\\text{Cylinder}', '2\\pi r h', '2\\pi r(r + h)', '\\pi r^2 h'],
        ['\\text{Cone}', '\\pi r l', '\\pi r(r + l)', '\\tfrac13\\pi r^2 h'],
        ['\\text{Sphere}', '4\\pi r^2', '4\\pi r^2', '\\tfrac43\\pi r^3'],
        ['\\text{Hemisphere}', '2\\pi r^2', '3\\pi r^2', '\\tfrac23\\pi r^3'],
        [
          '\\text{Frustum}',
          '\\pi l(R + r)',
          '\\pi l(R + r) + \\pi(R^2 + r^2)',
          '\\tfrac13\\pi h(R^2 + Rr + r^2)',
        ],
      ],
      'mensuration surface area volume 3d solids slant height',
    ),
    table(
      'derivative-integral',
      'Derivatives and integrals side by side',
      ['f(x)', "f'(x)", '\\displaystyle\\int f(x)\\,dx'],
      [
        ['x^n', 'n\\,x^{n-1}', '\\dfrac{x^{n+1}}{n+1} + C'],
        ['e^x', 'e^x', 'e^x + C'],
        ['a^x', 'a^x\\ln a', '\\dfrac{a^x}{\\ln a} + C'],
        ['\\ln x', '\\dfrac{1}{x}', 'x\\ln x - x + C'],
        ['\\sin x', '\\cos x', '-\\cos x + C'],
        ['\\cos x', '-\\sin x', '\\sin x + C'],
        ['\\tan x', '\\sec^2 x', '\\ln|\\sec x| + C'],
        ['\\sec x', '\\sec x\\tan x', '\\ln|\\sec x + \\tan x| + C'],
        ['\\dfrac{1}{1+x^2}', '-\\dfrac{2x}{(1+x^2)^2}', '\\tan^{-1} x + C'],
        [
          '\\dfrac{1}{\\sqrt{1-x^2}}',
          '\\dfrac{x}{(1-x^2)^{3/2}}',
          '\\sin^{-1} x + C',
        ],
      ],
      'calculus derivative integral antiderivative table differentiation',
    ),
    table(
      'exponents-logs',
      'Laws of exponents and logarithms',
      ['\\text{Exponents}', '\\text{Logarithms}'],
      [
        ['a^m\\,a^n = a^{m+n}', '\\log_a(xy) = \\log_a x + \\log_a y'],
        [
          '\\dfrac{a^m}{a^n} = a^{m-n}',
          '\\log_a\\dfrac{x}{y} = \\log_a x - \\log_a y',
        ],
        ['(a^m)^n = a^{mn}', '\\log_a x^n = n\\log_a x'],
        ['a^0 = 1', '\\log_a 1 = 0'],
        ['a^{-n} = \\dfrac{1}{a^n}', '\\log_a a = 1'],
        ['a^{1/n} = \\sqrt[n]{a}', '\\log_a x = \\dfrac{\\log_b x}{\\log_b a}'],
        ['(ab)^n = a^n b^n', 'a^{\\log_a x} = x'],
      ],
      'indices powers log rules change of base',
    ),
    table(
      'identities-table',
      'Algebraic identities',
      ['\\text{Expression}', '\\text{Expanded}'],
      [
        ['(a + b)^2', 'a^2 + 2ab + b^2'],
        ['(a - b)^2', 'a^2 - 2ab + b^2'],
        ['a^2 - b^2', '(a + b)(a - b)'],
        ['(a + b)^3', 'a^3 + 3a^2b + 3ab^2 + b^3'],
        ['(a - b)^3', 'a^3 - 3a^2b + 3ab^2 - b^3'],
        ['a^3 + b^3', '(a + b)(a^2 - ab + b^2)'],
        ['a^3 - b^3', '(a - b)(a^2 + ab + b^2)'],
        ['(a + b + c)^2', 'a^2 + b^2 + c^2 + 2ab + 2bc + 2ca'],
      ],
      'algebra expansion factorisation identities squares cubes',
    ),
    table(
      'series-table',
      'Arithmetic and geometric progressions',
      ['\\text{}', '\\text{Arithmetic (AP)}', '\\text{Geometric (GP)}'],
      [
        ['\\text{nth term}', 'a + (n-1)\\,d', 'a\\,r^{\\,n-1}'],
        [
          '\\text{Sum of n terms}',
          '\\tfrac{n}{2}\\,[2a + (n-1)\\,d]',
          '\\dfrac{a\\,(r^n - 1)}{r - 1}',
        ],
        [
          '\\text{Sum to infinity}',
          '\\text{—}',
          '\\dfrac{a}{1 - r},\\ |r| < 1',
        ],
        ['\\text{Mean of a and b}', '\\dfrac{a + b}{2}', '\\sqrt{ab}'],
      ],
      'sequence series ap gp nth term sum progression',
    ),
    table(
      'coordinate-table',
      'Coordinate geometry',
      ['\\text{Quantity}', '\\text{Formula}'],
      [
        ['\\text{Distance}', '\\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}'],
        [
          '\\text{Midpoint}',
          '\\left(\\dfrac{x_1 + x_2}{2},\\ \\dfrac{y_1 + y_2}{2}\\right)',
        ],
        ['\\text{Slope}', 'm = \\dfrac{y_2 - y_1}{x_2 - x_1} = \\tan\\theta'],
        ['\\text{Point–slope line}', 'y - y_1 = m(x - x_1)'],
        [
          '\\text{Point to line}',
          '\\dfrac{|a x_1 + b y_1 + c|}{\\sqrt{a^2 + b^2}}',
        ],
        [
          '\\text{Triangle area}',
          '\\tfrac12\\,|x_1(y_2 - y_3) + x_2(y_3 - y_1) + x_3(y_1 - y_2)|',
        ],
      ],
      'coordinate geometry distance midpoint slope line area',
    ),
    table(
      'squares-cubes',
      'Squares, cubes and roots, 1 to 15',
      ['n', 'n^2', 'n^3', '\\sqrt n'],
      Array.from({ length: 15 }, (_, index) => {
        const n = index + 1;
        const root = Math.sqrt(n);
        return [
          String(n),
          String(n * n),
          String(n ** 3),
          Number.isInteger(root) ? String(root) : root.toFixed(3),
        ];
      }),
      'squares cubes square roots table numbers',
    ),
  ],
};

// Sign rules and counting: the basics students get wrong most often.
const plus = '(+)';
const minus = '(-)';
const nCrRows = Array.from({ length: 11 }, (_, n) => [
  String(n),
  ...Array.from({ length: 11 }, (_, r) => {
    if (r > n) return '\\text{}';
    let value = 1;
    for (let k = 1; k <= r; k++) value = (value * (n - r + k)) / k;
    return String(Math.round(value));
  }),
]);
const factorial = (n) => (n <= 1 ? 1 : n * factorial(n - 1));

export const numberRules = {
  id: 'number-rules',
  title: 'Number rules & counting',
  subject: 'Maths',
  description:
    'Sign rules for plus, minus, multiply and divide, order of operations, factorials, and permutation and combination tables.',
  glyph: '±',
  color: '#d6336c',
  items: [
    table(
      'sign-multiply',
      'Signs when multiplying',
      ['\\times', plus, minus],
      [
        [plus, plus, minus],
        [minus, minus, plus],
      ],
      'sign rules multiply multiplication negative positive same different',
    ),
    table(
      'sign-divide',
      'Signs when dividing',
      ['\\div', plus, minus],
      [
        [plus, plus, minus],
        [minus, minus, plus],
      ],
      'sign rules divide division negative positive',
    ),
    f(
      'sign-rules',
      'Sign rules in short',
      [
        '(+)\\times(+) = + \\qquad (-)\\times(-) = +',
        '(+)\\times(-) = - \\qquad (-)\\times(+) = -',
        '(+)\\div(+) = + \\qquad (-)\\div(-) = +',
        '(+)\\div(-) = - \\qquad (-)\\div(+) = -',
        '\\text{Same signs give } +,\\ \\text{different signs give } -',
        '-(-a) = a \\qquad -(+a) = -a',
      ],
      'sign rules summary same different positive negative',
    ),
    table(
      'sign-add-subtract',
      'Adding and subtracting signed numbers',
      ['\\text{Case}', '\\text{Rule}', '\\text{Example}'],
      [
        ['(+a) + (+b)', '\\text{Add, answer is positive}', '3 + 5 = 8'],
        ['(-a) + (-b)', '\\text{Add, answer is negative}', '-3 + (-5) = -8'],
        [
          '(+a) + (-b)',
          '\\text{Subtract, keep the sign of the bigger}',
          '7 + (-3) = 4',
        ],
        [
          '(-a) + (+b)',
          '\\text{Subtract, keep the sign of the bigger}',
          '-7 + 3 = -4',
        ],
        ['a - (+b)', '\\text{Same as a − b}', '5 - (+2) = 3'],
        ['a - (-b)', '\\text{Same as a + b}', '5 - (-2) = 7'],
      ],
      'add subtract plus minus negative numbers integers sign',
    ),
    table(
      'order-of-operations',
      'Order of operations (BODMAS / PEMDAS)',
      ['\\text{Step}', '\\text{Do}', '\\text{Example}'],
      [
        ['1', '\\text{Brackets}', '2\\times(3+4) = 2\\times 7'],
        ['2', '\\text{Orders: powers and roots}', '3 + 2^3 = 3 + 8'],
        [
          '3',
          '\\text{Division and multiplication, left to right}',
          '12 \\div 3 \\times 2 = 8',
        ],
        [
          '4',
          '\\text{Addition and subtraction, left to right}',
          '10 - 4 + 1 = 7',
        ],
      ],
      'bodmas pemdas bidmas order of operations brackets precedence',
    ),
    f(
      'permutations-combinations',
      'Permutations and combinations',
      [
        'n! = n\\,(n-1)\\,(n-2)\\cdots 2\\cdot 1, \\qquad 0! = 1',
        '{}^{n}P_{r} = \\dfrac{n!}{(n-r)!} \\quad \\text{(order matters)}',
        '{}^{n}C_{r} = \\binom{n}{r} = \\dfrac{n!}{r!\\,(n-r)!} \\quad \\text{(order doesn’t matter)}',
        '\\binom{n}{r} = \\binom{n}{n-r} \\qquad \\binom{n}{r} + \\binom{n}{r-1} = \\binom{n+1}{r}',
        '\\sum_{r=0}^{n} \\binom{n}{r} = 2^n \\qquad {}^{n}P_{r} = r!\\,\\binom{n}{r}',
      ],
      'permutation combination npr ncr factorial choose arrangements selections',
    ),
    table(
      'combinations-table',
      'Combinations table nCr (Pascal’s triangle)',
      ['n \\backslash r', ...Array.from({ length: 11 }, (_, r) => String(r))],
      nCrRows,
      'ncr combinations table pascal triangle binomial coefficients choose',
    ),
    table(
      'permutations-table',
      'Permutations table nPr',
      ['n \\backslash r', '1', '2', '3', '4', '5'],
      Array.from({ length: 9 }, (_, i) => {
        const n = i + 2;
        return [
          String(n),
          ...[1, 2, 3, 4, 5].map((r) =>
            r > n ? '\\text{}' : String(factorial(n) / factorial(n - r)),
          ),
        ];
      }),
      'npr permutations table arrangements order',
    ),
    table(
      'factorials',
      'Factorials 0! to 12!',
      ['n', 'n!'],
      Array.from({ length: 13 }, (_, n) => [
        String(n),
        factorial(n).toLocaleString('en-US').replace(/,/g, '{,}'),
      ]),
      'factorial table n! values',
    ),
  ],
};

// Times tables from 2 to 20, one item each, plus a chart of them all.
const timesTable = (n) => ({
  type: 'formula',
  id: `table-${n}`,
  title: `Table of ${n}`,
  lines: [
    `\\begin{aligned} ${Array.from(
      { length: 10 },
      (_, i) => `${n} \\times ${i + 1} &= ${n * (i + 1)}`,
    ).join(' \\\\ ')} \\end{aligned}`,
  ],
  keywords: `multiplication times table ${n} pahade`,
});

export const multiplicationTables = {
  id: 'multiplication-tables',
  title: 'Multiplication tables',
  subject: 'Maths',
  description:
    'Times tables from 2 to 20 (each up to × 10), one card per table, plus a chart of them all.',
  glyph: '×',
  color: '#f08c00',
  items: [
    table(
      'times-chart',
      'Multiplication chart 2 to 20',
      ['\\times', ...Array.from({ length: 10 }, (_, i) => String(i + 1))],
      Array.from({ length: 19 }, (_, row) => {
        const n = row + 2;
        return [
          String(n),
          ...Array.from({ length: 10 }, (_, i) => String(n * (i + 1))),
        ];
      }),
      'multiplication chart grid times tables 2 to 20',
    ),
    ...Array.from({ length: 19 }, (_, i) => timesTable(i + 2)),
  ],
};
