// Geometry, physics, symbols, chemistry, and teaching-template packs.

const f = (id, title, lines, keywords = '', extra = {}) => ({
  type: 'formula',
  id,
  title,
  lines,
  keywords,
  ...extra,
});
const table = (id, title, header, rows, keywords = '', extra = {}) => ({
  type: 'table',
  id,
  title,
  header,
  rows,
  keywords,
  ...extra,
});

export const geometry = {
  id: 'geometry',
  title: 'Geometry & mensuration',
  subject: 'Maths',
  description:
    'Areas, perimeters, surface areas and volumes with diagrams, plus coordinate geometry.',
  glyph: '△',
  color: '#f08c00',
  items: [
    f(
      'pythagoras',
      "Pythagoras' theorem",
      ['a^2 + b^2 = c^2'],
      'right triangle hypotenuse',
      {
        diagram: 'rightTriangle',
      },
    ),
    f(
      'triangle-area',
      'Triangle',
      [
        'A = \\tfrac{1}{2}\\,b\\,h',
        'A = \\sqrt{s(s - a)(s - b)(s - c)}, \\quad s = \\dfrac{a + b + c}{2}',
      ],
      "area heron's formula",
      { diagram: 'triangle' },
    ),
    f(
      'rectangle-square',
      'Rectangle and square',
      [
        '\\text{Rectangle: } A = lb, \\;\\; P = 2(l + b)',
        '\\text{Square: } A = a^2, \\;\\; P = 4a, \\;\\; d = a\\sqrt{2}',
      ],
      'area perimeter diagonal',
      { diagram: 'rectangle' },
    ),
    f(
      'quadrilaterals',
      'Parallelogram, trapezium, rhombus',
      [
        '\\text{Parallelogram: } A = b\\,h',
        '\\text{Trapezium: } A = \\tfrac{1}{2}(a + b)\\,h',
        '\\text{Rhombus: } A = \\tfrac{1}{2}\\,d_1 d_2',
      ],
      'area trapezoid',
      { diagram: 'trapezium' },
    ),
    f(
      'circle',
      'Circle',
      [
        'A = \\pi r^2 \\qquad C = 2\\pi r = \\pi d',
        '\\text{Arc } l = r\\theta \\qquad \\text{Sector } A = \\tfrac{1}{2}r^2\\theta \\quad (\\theta \\text{ in radians})',
      ],
      'circumference arc sector',
      { diagram: 'circle' },
    ),
    f(
      'cube-cuboid',
      'Cube and cuboid',
      [
        '\\text{Cube: } V = a^3, \\;\\; \\text{TSA} = 6a^2',
        '\\text{Cuboid: } V = lbh, \\;\\; \\text{TSA} = 2(lb + bh + hl)',
      ],
      'volume surface area box',
      { diagram: 'cuboid' },
    ),
    f(
      'cylinder',
      'Cylinder',
      [
        'V = \\pi r^2 h',
        '\\text{CSA} = 2\\pi r h \\qquad \\text{TSA} = 2\\pi r(r + h)',
      ],
      'volume surface area',
      { diagram: 'cylinder' },
    ),
    f(
      'cone',
      'Cone',
      [
        'V = \\tfrac{1}{3}\\pi r^2 h \\qquad l = \\sqrt{r^2 + h^2}',
        '\\text{CSA} = \\pi r l \\qquad \\text{TSA} = \\pi r(l + r)',
      ],
      'volume slant height',
      { diagram: 'cone' },
    ),
    f(
      'sphere',
      'Sphere and hemisphere',
      [
        '\\text{Sphere: } V = \\tfrac{4}{3}\\pi r^3, \\;\\; A = 4\\pi r^2',
        '\\text{Hemisphere: } V = \\tfrac{2}{3}\\pi r^3, \\;\\; \\text{CSA} = 2\\pi r^2, \\;\\; \\text{TSA} = 3\\pi r^2',
      ],
      'volume surface area ball',
      { diagram: 'sphere' },
    ),
    f(
      'coordinate-geometry',
      'Coordinate geometry',
      [
        'd = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2} \\qquad M = \\left(\\dfrac{x_1 + x_2}{2}, \\dfrac{y_1 + y_2}{2}\\right)',
        'm = \\dfrac{y_2 - y_1}{x_2 - x_1} \\qquad y = mx + c \\qquad y - y_1 = m(x - x_1)',
        '\\text{Section: } \\left(\\dfrac{m x_2 + n x_1}{m + n}, \\dfrac{m y_2 + n y_1}{m + n}\\right)',
      ],
      'distance midpoint slope line',
    ),
    f(
      'conics',
      'Circle and conics',
      [
        '(x - h)^2 + (y - k)^2 = r^2',
        'y^2 = 4ax \\qquad \\dfrac{x^2}{a^2} + \\dfrac{y^2}{b^2} = 1 \\qquad \\dfrac{x^2}{a^2} - \\dfrac{y^2}{b^2} = 1',
      ],
      'parabola ellipse hyperbola',
    ),
    f(
      'angles-polygons',
      'Angles in polygons',
      [
        '\\text{Interior angle sum} = (n - 2) \\times 180^\\circ',
        '\\text{Each exterior angle of a regular polygon} = \\dfrac{360^\\circ}{n}',
      ],
      'polygon angle sum',
    ),
  ],
};

export const physics = {
  id: 'physics',
  title: 'Physics essentials',
  subject: 'Physics',
  description:
    'Physical constants, SI units and prefixes, and the core equations of mechanics and electricity.',
  glyph: 'F=ma',
  color: '#1971c2',
  items: [
    table(
      'constants',
      'Physical constants',
      ['\\text{Constant}', '\\text{Symbol}', '\\text{Value}'],
      [
        [
          '\\text{Speed of light}',
          'c',
          '2.998 \\times 10^{8}\\ \\text{m s}^{-1}',
        ],
        [
          '\\text{Gravitational constant}',
          'G',
          '6.674 \\times 10^{-11}\\ \\text{N m}^2\\,\\text{kg}^{-2}',
        ],
        [
          '\\text{Planck constant}',
          'h',
          '6.626 \\times 10^{-34}\\ \\text{J s}',
        ],
        [
          '\\text{Elementary charge}',
          'e',
          '1.602 \\times 10^{-19}\\ \\text{C}',
        ],
        ['\\text{Electron mass}', 'm_e', '9.109 \\times 10^{-31}\\ \\text{kg}'],
        ['\\text{Proton mass}', 'm_p', '1.673 \\times 10^{-27}\\ \\text{kg}'],
        [
          '\\text{Avogadro constant}',
          'N_A',
          '6.022 \\times 10^{23}\\ \\text{mol}^{-1}',
        ],
        [
          '\\text{Boltzmann constant}',
          'k_B',
          '1.381 \\times 10^{-23}\\ \\text{J K}^{-1}',
        ],
        [
          '\\text{Gas constant}',
          'R',
          '8.314\\ \\text{J mol}^{-1}\\,\\text{K}^{-1}',
        ],
        [
          '\\text{Permittivity of free space}',
          '\\varepsilon_0',
          '8.854 \\times 10^{-12}\\ \\text{F m}^{-1}',
        ],
        [
          '\\text{Permeability of free space}',
          '\\mu_0',
          '1.257 \\times 10^{-6}\\ \\text{N A}^{-2}',
        ],
        [
          '\\text{Coulomb constant}',
          'k = \\tfrac{1}{4\\pi\\varepsilon_0}',
          '8.988 \\times 10^{9}\\ \\text{N m}^2\\,\\text{C}^{-2}',
        ],
        [
          '\\text{Stefan–Boltzmann constant}',
          '\\sigma',
          '5.670 \\times 10^{-8}\\ \\text{W m}^{-2}\\,\\text{K}^{-4}',
        ],
        ['\\text{Standard gravity}', 'g', '9.81\\ \\text{m s}^{-2}'],
        [
          '\\text{Atomic mass unit}',
          'u',
          '1.661 \\times 10^{-27}\\ \\text{kg}',
        ],
        [
          '\\text{Electronvolt}',
          '\\mathrm{eV}',
          '1.602 \\times 10^{-19}\\ \\text{J}',
        ],
      ],
      'constants values c G h e',
    ),
    table(
      'si-base-units',
      'SI base units',
      ['\\text{Quantity}', '\\text{Unit}', '\\text{Symbol}'],
      [
        ['\\text{Length}', '\\text{metre}', '\\text{m}'],
        ['\\text{Mass}', '\\text{kilogram}', '\\text{kg}'],
        ['\\text{Time}', '\\text{second}', '\\text{s}'],
        ['\\text{Electric current}', '\\text{ampere}', '\\text{A}'],
        ['\\text{Temperature}', '\\text{kelvin}', '\\text{K}'],
        ['\\text{Amount of substance}', '\\text{mole}', '\\text{mol}'],
        ['\\text{Luminous intensity}', '\\text{candela}', '\\text{cd}'],
      ],
      'units base SI',
    ),
    table(
      'si-prefixes',
      'SI prefixes',
      ['\\text{Prefix}', '\\text{Symbol}', '\\text{Factor}'],
      [
        ['\\text{peta}', '\\text{P}', '10^{15}'],
        ['\\text{tera}', '\\text{T}', '10^{12}'],
        ['\\text{giga}', '\\text{G}', '10^{9}'],
        ['\\text{mega}', '\\text{M}', '10^{6}'],
        ['\\text{kilo}', '\\text{k}', '10^{3}'],
        ['\\text{hecto}', '\\text{h}', '10^{2}'],
        ['\\text{deca}', '\\text{da}', '10^{1}'],
        ['\\text{deci}', '\\text{d}', '10^{-1}'],
        ['\\text{centi}', '\\text{c}', '10^{-2}'],
        ['\\text{milli}', '\\text{m}', '10^{-3}'],
        ['\\text{micro}', '\\mu', '10^{-6}'],
        ['\\text{nano}', '\\text{n}', '10^{-9}'],
        ['\\text{pico}', '\\text{p}', '10^{-12}'],
        ['\\text{femto}', '\\text{f}', '10^{-15}'],
      ],
      'prefix kilo mega micro nano',
    ),
    table(
      'derived-units',
      'Derived units',
      ['\\text{Quantity}', '\\text{Unit}', '\\text{In base units}'],
      [
        ['\\text{Force}', '\\text{newton (N)}', '\\text{kg m s}^{-2}'],
        ['\\text{Energy, work}', '\\text{joule (J)}', '\\text{N m}{}'],
        ['\\text{Power}', '\\text{watt (W)}', '\\text{J s}^{-1}'],
        ['\\text{Pressure}', '\\text{pascal (Pa)}', '\\text{N m}^{-2}'],
        ['\\text{Frequency}', '\\text{hertz (Hz)}', '\\text{s}^{-1}'],
        ['\\text{Charge}', '\\text{coulomb (C)}', '\\text{A s}{}'],
        [
          '\\text{Potential difference}',
          '\\text{volt (V)}',
          '\\text{W A}^{-1}',
        ],
        ['\\text{Resistance}', '\\text{ohm (Ω)}', '\\text{V A}^{-1}'],
        ['\\text{Capacitance}', '\\text{farad (F)}', '\\text{C V}^{-1}'],
        [
          '\\text{Magnetic flux density}',
          '\\text{tesla (T)}',
          '\\text{Wb m}^{-2}',
        ],
      ],
      'units derived newton joule watt',
    ),
    f(
      'kinematics',
      'Equations of motion',
      [
        'v = u + at \\qquad s = ut + \\tfrac{1}{2}at^2',
        'v^2 = u^2 + 2as \\qquad s = \\tfrac{1}{2}(u + v)\\,t',
      ],
      'suvat kinematics motion',
    ),
    f(
      'dynamics',
      'Force, momentum, energy',
      [
        'F = ma \\qquad p = mv \\qquad F\\,\\Delta t = \\Delta p',
        'W = Fs\\cos\\theta \\qquad KE = \\tfrac{1}{2}mv^2 \\qquad PE = mgh \\qquad P = \\dfrac{W}{t}',
      ],
      'newton work energy power momentum',
    ),
    f(
      'circular-gravity',
      'Circular motion and gravitation',
      [
        'a = \\dfrac{v^2}{r} = \\omega^2 r \\qquad F = \\dfrac{mv^2}{r} \\qquad v = \\omega r',
        'F = \\dfrac{G m_1 m_2}{r^2} \\qquad g = \\dfrac{GM}{R^2}',
      ],
      'centripetal gravitation',
    ),
    f(
      'electricity',
      'Current electricity',
      [
        'V = IR \\qquad P = VI = I^2 R = \\dfrac{V^2}{R} \\qquad Q = It',
        'R_s = R_1 + R_2 + \\cdots \\qquad \\dfrac{1}{R_p} = \\dfrac{1}{R_1} + \\dfrac{1}{R_2} + \\cdots',
        'R = \\dfrac{\\rho L}{A}',
      ],
      "ohm's law resistors series parallel",
    ),
    f(
      'waves-optics',
      'Waves and optics',
      [
        'v = f\\lambda \\qquad T = \\dfrac{1}{f} \\qquad E = hf',
        '\\dfrac{1}{f} = \\dfrac{1}{v} - \\dfrac{1}{u} \\;\\text{(lens)} \\qquad \\dfrac{1}{f} = \\dfrac{1}{v} + \\dfrac{1}{u} \\;\\text{(mirror)}',
        'n = \\dfrac{c}{v} \\qquad n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2',
      ],
      'wave lens mirror snell refraction',
    ),
  ],
};

const greekLetters = [
  ['\\alpha', '\\mathrm{A}', 'alpha'],
  ['\\beta', '\\mathrm{B}', 'beta'],
  ['\\gamma', '\\Gamma', 'gamma'],
  ['\\delta', '\\Delta', 'delta'],
  ['\\epsilon', '\\mathrm{E}', 'epsilon'],
  ['\\zeta', '\\mathrm{Z}', 'zeta'],
  ['\\eta', '\\mathrm{H}', 'eta'],
  ['\\theta', '\\Theta', 'theta'],
  ['\\iota', '\\mathrm{I}', 'iota'],
  ['\\kappa', '\\mathrm{K}', 'kappa'],
  ['\\lambda', '\\Lambda', 'lambda'],
  ['\\mu', '\\mathrm{M}', 'mu'],
  ['\\nu', '\\mathrm{N}', 'nu'],
  ['\\xi', '\\Xi', 'xi'],
  ['o', '\\mathrm{O}', 'omicron'],
  ['\\pi', '\\Pi', 'pi'],
  ['\\rho', '\\mathrm{P}', 'rho'],
  ['\\sigma', '\\Sigma', 'sigma'],
  ['\\tau', '\\mathrm{T}', 'tau'],
  ['\\upsilon', '\\Upsilon', 'upsilon'],
  ['\\phi', '\\Phi', 'phi'],
  ['\\chi', '\\mathrm{X}', 'chi'],
  ['\\psi', '\\Psi', 'psi'],
  ['\\omega', '\\Omega', 'omega'],
];

const singleSymbols = [
  ['theta', '\\theta', 'theta angle'],
  ['pi', '\\pi', 'pi'],
  ['alpha', '\\alpha', 'alpha'],
  ['beta', '\\beta', 'beta'],
  ['lambda', '\\lambda', 'lambda wavelength'],
  ['mu', '\\mu', 'mu micro'],
  ['omega', '\\omega', 'omega angular'],
  ['delta-upper', '\\Delta', 'delta change'],
  ['sigma-upper', '\\Sigma', 'sigma sum'],
  ['omega-upper', '\\Omega', 'ohm omega'],
  ['infinity', '\\infty', 'infinity'],
  ['integral', '\\int', 'integral'],
  ['square-root', '\\sqrt{\\;\\;}', 'square root'],
  ['plus-minus', '\\pm', 'plus minus'],
  ['therefore', '\\therefore', 'therefore'],
  ['not-equal', '\\ne', 'not equal'],
];

export const symbols = {
  id: 'greek-symbols',
  title: 'Greek letters & symbols',
  subject: 'Maths',
  description:
    'The Greek alphabet, common maths symbols with meanings, and single symbols to drop in while writing.',
  glyph: 'αβ',
  color: '#5f3dc4',
  items: [
    table(
      'greek-alphabet',
      'Greek alphabet',
      [
        '\\text{Lower}',
        '\\text{Upper}',
        '\\text{Name}',
        '\\text{Lower}',
        '\\text{Upper}',
        '\\text{Name}',
      ],
      greekLetters.slice(0, 12).map((row, index) => {
        const other = greekLetters[index + 12];
        return [
          row[0],
          row[1],
          `\\text{${row[2]}}`,
          other[0],
          other[1],
          `\\text{${other[2]}}`,
        ];
      }),
      'greek alphabet letters',
    ),
    table(
      'math-symbols',
      'Maths symbols',
      [
        '\\text{Symbol}',
        '\\text{Meaning}',
        '\\text{Symbol}',
        '\\text{Meaning}',
      ],
      [
        ['\\ne', '\\text{not equal to}', '\\in', '\\text{is an element of}'],
        [
          '\\approx',
          '\\text{approximately}',
          '\\notin',
          '\\text{is not an element of}',
        ],
        [
          '\\le,\\ \\ge',
          '\\text{at most, at least}',
          '\\subseteq',
          '\\text{is a subset of}',
        ],
        [
          '\\propto',
          '\\text{proportional to}',
          '\\cup,\\ \\cap',
          '\\text{union, intersection}',
        ],
        ['\\infty', '\\text{infinity}', '\\varnothing', '\\text{empty set}'],
        ['\\textstyle\\sum', '\\text{sum}', '\\forall', '\\text{for all}'],
        [
          '\\textstyle\\prod',
          '\\text{product}',
          '\\exists',
          '\\text{there exists}',
        ],
        [
          '\\textstyle\\int',
          '\\text{integral}',
          '\\Rightarrow',
          '\\text{implies}',
        ],
        [
          '\\partial',
          '\\text{partial derivative}',
          '\\Leftrightarrow',
          '\\text{if and only if}',
        ],
        [
          '\\nabla',
          '\\text{gradient (del)}',
          '\\therefore',
          '\\text{therefore}',
        ],
        ['\\perp', '\\text{perpendicular}', '\\because', '\\text{because}'],
        ['\\parallel', '\\text{parallel}', '\\angle', '\\text{angle}'],
      ],
      'symbols meaning set logic',
    ),
    ...singleSymbols.map(([id, tex, keywords]) => ({
      type: 'symbol',
      id: `symbol-${id}`,
      title: keywords.split(' ')[0],
      tex,
      keywords: `symbol ${keywords}`,
    })),
  ],
};

export const templates = {
  id: 'teaching-templates',
  title: 'Teaching templates',
  subject: 'Templates',
  description:
    'Coordinate axes, graph paper, a number line, Venn diagrams, a protractor, and a blank table.',
  glyph: '⊞',
  color: '#495057',
  items: [
    {
      type: 'diagram',
      id: 'axes',
      title: 'Coordinate axes',
      draw: 'axes',
      keywords: 'graph cartesian plane xy',
    },
    {
      type: 'diagram',
      id: 'graph-paper',
      title: 'Graph paper',
      draw: 'graphPaper',
      keywords: 'grid squared',
    },
    {
      type: 'diagram',
      id: 'number-line',
      title: 'Number line',
      draw: 'numberLine',
      keywords: 'integers negative',
    },
    {
      type: 'diagram',
      id: 'venn-2',
      title: 'Venn diagram, two sets',
      draw: 'venn2',
      keywords: 'sets union intersection',
    },
    {
      type: 'diagram',
      id: 'venn-3',
      title: 'Venn diagram, three sets',
      draw: 'venn3',
      keywords: 'sets',
    },
    {
      type: 'diagram',
      id: 'protractor',
      title: 'Protractor',
      draw: 'protractor',
      keywords: 'angle measure degrees',
    },
    {
      type: 'diagram',
      id: 'table-grid',
      title: 'Blank table',
      draw: 'tableGrid',
      keywords: 'grid rows columns',
    },
  ],
};
