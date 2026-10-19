// Maths packs for the board library. Each formula item is a caption plus
// one or more TeX lines; tables list a header row and body rows of TeX.

const f = (id, title, lines, keywords = '') => ({
  type: 'formula',
  id,
  title,
  lines,
  keywords,
});
const table = (id, title, header, rows, keywords = '') => ({
  type: 'table',
  id,
  title,
  header,
  rows,
  keywords,
});

export const trigonometry = {
  id: 'trigonometry',
  title: 'Trigonometry',
  subject: 'Maths',
  description:
    'Identities, the standard-angle table, the unit circle, and the sine and cosine rules.',
  glyph: 'sin θ',
  color: '#2d5bff',
  items: [
    {
      type: 'diagram',
      id: 'unit-circle',
      title: 'Unit circle',
      draw: 'unitCircle',
      keywords: 'radians degrees coordinates angles',
    },
    table(
      'standard-angles',
      'Standard angle values',
      [
        '\\theta',
        '0^\\circ',
        '30^\\circ',
        '45^\\circ',
        '60^\\circ',
        '90^\\circ',
      ],
      [
        [
          '\\sin\\theta',
          '0',
          '\\tfrac{1}{2}',
          '\\tfrac{1}{\\sqrt{2}}',
          '\\tfrac{\\sqrt{3}}{2}',
          '1',
        ],
        [
          '\\cos\\theta',
          '1',
          '\\tfrac{\\sqrt{3}}{2}',
          '\\tfrac{1}{\\sqrt{2}}',
          '\\tfrac{1}{2}',
          '0',
        ],
        [
          '\\tan\\theta',
          '0',
          '\\tfrac{1}{\\sqrt{3}}',
          '1',
          '\\sqrt{3}',
          '\\text{n.d.}',
        ],
        [
          '\\csc\\theta',
          '\\text{n.d.}',
          '2',
          '\\sqrt{2}',
          '\\tfrac{2}{\\sqrt{3}}',
          '1',
        ],
        [
          '\\sec\\theta',
          '1',
          '\\tfrac{2}{\\sqrt{3}}',
          '\\sqrt{2}',
          '2',
          '\\text{n.d.}',
        ],
        [
          '\\cot\\theta',
          '\\text{n.d.}',
          '\\sqrt{3}',
          '1',
          '\\tfrac{1}{\\sqrt{3}}',
          '0',
        ],
      ],
      'sin cos tan table 30 45 60 90 values',
    ),
    {
      type: 'diagram',
      id: 'astc',
      title: 'Signs by quadrant (ASTC)',
      draw: 'astc',
      keywords: 'all sin tan cos quadrant positive',
    },
    f(
      'pythagorean',
      'Pythagorean identities',
      [
        '\\sin^2\\theta + \\cos^2\\theta = 1',
        '1 + \\tan^2\\theta = \\sec^2\\theta',
        '1 + \\cot^2\\theta = \\csc^2\\theta',
      ],
      'identity squares',
    ),
    f(
      'reciprocal',
      'Reciprocal and quotient identities',
      [
        '\\tan\\theta = \\dfrac{\\sin\\theta}{\\cos\\theta} \\qquad \\cot\\theta = \\dfrac{\\cos\\theta}{\\sin\\theta}',
        '\\csc\\theta = \\dfrac{1}{\\sin\\theta} \\qquad \\sec\\theta = \\dfrac{1}{\\cos\\theta}',
      ],
      'cosec sec cot',
    ),
    f(
      'complementary',
      'Complementary angles',
      [
        '\\sin(90^\\circ - \\theta) = \\cos\\theta',
        '\\cos(90^\\circ - \\theta) = \\sin\\theta',
        '\\tan(90^\\circ - \\theta) = \\cot\\theta',
      ],
      'allied angles',
    ),
    f(
      'sum-difference',
      'Sum and difference formulas',
      [
        '\\sin(A \\pm B) = \\sin A\\cos B \\pm \\cos A\\sin B',
        '\\cos(A \\pm B) = \\cos A\\cos B \\mp \\sin A\\sin B',
        '\\tan(A \\pm B) = \\dfrac{\\tan A \\pm \\tan B}{1 \\mp \\tan A\\tan B}',
      ],
      'compound angle addition',
    ),
    f(
      'double-angle',
      'Double angle formulas',
      [
        '\\sin 2\\theta = 2\\sin\\theta\\cos\\theta',
        '\\cos 2\\theta = \\cos^2\\theta - \\sin^2\\theta = 2\\cos^2\\theta - 1 = 1 - 2\\sin^2\\theta',
        '\\tan 2\\theta = \\dfrac{2\\tan\\theta}{1 - \\tan^2\\theta}',
      ],
      'multiple angle',
    ),
    f(
      'half-angle',
      'Half angle formulas',
      [
        '\\sin\\dfrac{\\theta}{2} = \\pm\\sqrt{\\dfrac{1 - \\cos\\theta}{2}} \\qquad \\cos\\dfrac{\\theta}{2} = \\pm\\sqrt{\\dfrac{1 + \\cos\\theta}{2}}',
        '\\tan\\dfrac{\\theta}{2} = \\dfrac{1 - \\cos\\theta}{\\sin\\theta} = \\dfrac{\\sin\\theta}{1 + \\cos\\theta}',
      ],
      'submultiple',
    ),
    f('triple-angle', 'Triple angle formulas', [
      '\\sin 3\\theta = 3\\sin\\theta - 4\\sin^3\\theta',
      '\\cos 3\\theta = 4\\cos^3\\theta - 3\\cos\\theta',
      '\\tan 3\\theta = \\dfrac{3\\tan\\theta - \\tan^3\\theta}{1 - 3\\tan^2\\theta}',
    ]),
    f('product-to-sum', 'Product to sum', [
      '2\\sin A\\cos B = \\sin(A+B) + \\sin(A-B)',
      '2\\cos A\\sin B = \\sin(A+B) - \\sin(A-B)',
      '2\\cos A\\cos B = \\cos(A+B) + \\cos(A-B)',
      '2\\sin A\\sin B = \\cos(A-B) - \\cos(A+B)',
    ]),
    f('sum-to-product', 'Sum to product', [
      '\\sin C + \\sin D = 2\\sin\\dfrac{C+D}{2}\\cos\\dfrac{C-D}{2}',
      '\\sin C - \\sin D = 2\\cos\\dfrac{C+D}{2}\\sin\\dfrac{C-D}{2}',
      '\\cos C + \\cos D = 2\\cos\\dfrac{C+D}{2}\\cos\\dfrac{C-D}{2}',
      '\\cos C - \\cos D = -2\\sin\\dfrac{C+D}{2}\\sin\\dfrac{C-D}{2}',
    ]),
    f(
      'triangle-rules',
      'Sine rule, cosine rule, area',
      [
        '\\dfrac{a}{\\sin A} = \\dfrac{b}{\\sin B} = \\dfrac{c}{\\sin C} = 2R',
        'c^2 = a^2 + b^2 - 2ab\\cos C',
        '\\text{Area} = \\tfrac{1}{2}ab\\sin C',
      ],
      'law of sines cosines triangle',
    ),
    f(
      'radians',
      'Degrees and radians',
      [
        '\\pi \\text{ rad} = 180^\\circ',
        '1 \\text{ rad} = \\dfrac{180^\\circ}{\\pi} \\approx 57.3^\\circ \\qquad 1^\\circ = \\dfrac{\\pi}{180} \\text{ rad}',
        '\\text{arc length } l = r\\theta',
      ],
      'convert angle',
    ),
  ],
};

export const algebra = {
  id: 'algebra',
  title: 'Algebra essentials',
  subject: 'Maths',
  description:
    'Quadratics, identities, the binomial theorem, logs and exponents, series, and counting.',
  glyph: 'x²',
  color: '#7c4dff',
  items: [
    f(
      'quadratic-formula',
      'Quadratic formula',
      [
        'ax^2 + bx + c = 0 \\;\\Rightarrow\\; x = \\dfrac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
        'D = b^2 - 4ac \\qquad \\alpha + \\beta = -\\dfrac{b}{a} \\qquad \\alpha\\beta = \\dfrac{c}{a}',
      ],
      'roots discriminant',
    ),
    f(
      'square-identities',
      'Algebraic identities',
      [
        '(a + b)^2 = a^2 + 2ab + b^2',
        '(a - b)^2 = a^2 - 2ab + b^2',
        'a^2 - b^2 = (a + b)(a - b)',
        '(a + b + c)^2 = a^2 + b^2 + c^2 + 2ab + 2bc + 2ca',
      ],
      'expansion square',
    ),
    f(
      'cube-identities',
      'Cube identities',
      [
        '(a + b)^3 = a^3 + 3a^2b + 3ab^2 + b^3',
        '(a - b)^3 = a^3 - 3a^2b + 3ab^2 - b^3',
        'a^3 + b^3 = (a + b)(a^2 - ab + b^2)',
        'a^3 - b^3 = (a - b)(a^2 + ab + b^2)',
      ],
      'expansion cube',
    ),
    f(
      'binomial',
      'Binomial theorem',
      [
        '(x + y)^n = \\sum_{r=0}^{n} \\binom{n}{r} x^{n-r} y^{r}',
        'T_{r+1} = \\binom{n}{r} x^{n-r} y^{r} \\qquad \\binom{n}{r} = \\dfrac{n!}{r!\\,(n-r)!}',
      ],
      'expansion general term',
    ),
    f(
      'exponents',
      'Laws of exponents',
      [
        'a^m \\cdot a^n = a^{m+n} \\qquad \\dfrac{a^m}{a^n} = a^{m-n} \\qquad (a^m)^n = a^{mn}',
        'a^0 = 1 \\qquad a^{-n} = \\dfrac{1}{a^n} \\qquad a^{1/n} = \\sqrt[n]{a} \\qquad (ab)^n = a^n b^n',
      ],
      'indices powers',
    ),
    f(
      'logarithms',
      'Laws of logarithms',
      [
        '\\log_a(mn) = \\log_a m + \\log_a n \\qquad \\log_a\\dfrac{m}{n} = \\log_a m - \\log_a n',
        '\\log_a m^k = k\\log_a m \\qquad \\log_a b = \\dfrac{\\log_c b}{\\log_c a}',
        'a^{\\log_a x} = x \\qquad \\log_a 1 = 0 \\qquad \\log_a a = 1',
      ],
      'log change of base',
    ),
    f(
      'arithmetic-progression',
      'Arithmetic progression',
      [
        'a_n = a + (n - 1)d',
        'S_n = \\dfrac{n}{2}\\left[2a + (n - 1)d\\right] = \\dfrac{n}{2}(a + l)',
      ],
      'AP series sum nth term',
    ),
    f(
      'geometric-progression',
      'Geometric progression',
      [
        'a_n = a r^{\\,n-1}',
        'S_n = \\dfrac{a(r^n - 1)}{r - 1} \\;\\; (r \\ne 1) \\qquad S_\\infty = \\dfrac{a}{1 - r} \\;\\; (|r| < 1)',
      ],
      'GP series sum infinite',
    ),
    f(
      'special-sums',
      'Sums of powers',
      [
        '\\sum_{k=1}^{n} k = \\dfrac{n(n+1)}{2}',
        '\\sum_{k=1}^{n} k^2 = \\dfrac{n(n+1)(2n+1)}{6}',
        '\\sum_{k=1}^{n} k^3 = \\left[\\dfrac{n(n+1)}{2}\\right]^2',
      ],
      'natural numbers series',
    ),
    f(
      'permutations',
      'Permutations and combinations',
      [
        '{}^{n}P_{r} = \\dfrac{n!}{(n-r)!} \\qquad {}^{n}C_{r} = \\dfrac{n!}{r!\\,(n-r)!}',
        '{}^{n}C_{r} = {}^{n}C_{n-r} \\qquad {}^{n}C_{r} + {}^{n}C_{r-1} = {}^{n+1}C_{r}',
      ],
      'nPr nCr counting factorial',
    ),
    f(
      'complex-numbers',
      'Complex numbers',
      [
        'i^2 = -1 \\qquad z = a + bi \\qquad |z| = \\sqrt{a^2 + b^2} \\qquad \\bar{z} = a - bi',
        'e^{i\\theta} = \\cos\\theta + i\\sin\\theta',
        '(\\cos\\theta + i\\sin\\theta)^n = \\cos n\\theta + i\\sin n\\theta',
      ],
      'euler de moivre modulus conjugate',
    ),
    f(
      'am-gm',
      'Mean inequality',
      [
        '\\dfrac{a + b}{2} \\;\\ge\\; \\sqrt{ab} \\;\\ge\\; \\dfrac{2ab}{a + b} \\quad (a, b > 0)',
      ],
      'AM GM HM',
    ),
  ],
};

export const differentiation = {
  id: 'differential-calculus',
  title: 'Differential calculus',
  subject: 'Maths',
  description:
    'Limits, standard derivatives, the product, quotient and chain rules, and applications.',
  glyph: 'd/dx',
  color: '#00a37a',
  items: [
    f(
      'derivative-definition',
      'Definition of the derivative',
      ["f'(x) = \\lim_{h \\to 0} \\dfrac{f(x + h) - f(x)}{h}"],
      'first principles',
    ),
    f(
      'standard-limits',
      'Standard limits',
      [
        '\\lim_{x \\to 0} \\dfrac{\\sin x}{x} = 1 \\qquad \\lim_{x \\to 0} \\dfrac{1 - \\cos x}{x} = 0 \\qquad \\lim_{x \\to 0} \\dfrac{\\tan x}{x} = 1',
        '\\lim_{x \\to 0} (1 + x)^{1/x} = e \\qquad \\lim_{x \\to 0} \\dfrac{e^x - 1}{x} = 1 \\qquad \\lim_{x \\to 0} \\dfrac{a^x - 1}{x} = \\ln a',
        '\\lim_{x \\to 0} \\dfrac{\\ln(1 + x)}{x} = 1 \\qquad \\lim_{x \\to a} \\dfrac{x^n - a^n}{x - a} = n a^{n-1}',
      ],
      'limit',
    ),
    f(
      'lhopital',
      "L'Hôpital's rule",
      [
        "\\lim_{x \\to a} \\dfrac{f(x)}{g(x)} = \\lim_{x \\to a} \\dfrac{f'(x)}{g'(x)} \\quad \\text{for } \\tfrac{0}{0} \\text{ or } \\tfrac{\\infty}{\\infty}",
      ],
      'limit indeterminate',
    ),
    f(
      'basic-derivatives',
      'Standard derivatives',
      [
        '\\dfrac{d}{dx}x^n = nx^{n-1} \\qquad \\dfrac{d}{dx}e^x = e^x \\qquad \\dfrac{d}{dx}a^x = a^x\\ln a',
        '\\dfrac{d}{dx}\\ln x = \\dfrac{1}{x} \\qquad \\dfrac{d}{dx}\\log_a x = \\dfrac{1}{x\\ln a} \\qquad \\dfrac{d}{dx}c = 0',
      ],
      'power exponential log',
    ),
    f(
      'trig-derivatives',
      'Derivatives of trig functions',
      [
        '\\dfrac{d}{dx}\\sin x = \\cos x \\qquad \\dfrac{d}{dx}\\cos x = -\\sin x \\qquad \\dfrac{d}{dx}\\tan x = \\sec^2 x',
        '\\dfrac{d}{dx}\\cot x = -\\csc^2 x \\qquad \\dfrac{d}{dx}\\sec x = \\sec x\\tan x \\qquad \\dfrac{d}{dx}\\csc x = -\\csc x\\cot x',
      ],
      'sin cos tan derivative',
    ),
    f(
      'inverse-trig-derivatives',
      'Derivatives of inverse trig functions',
      [
        '\\dfrac{d}{dx}\\sin^{-1}x = \\dfrac{1}{\\sqrt{1 - x^2}} \\qquad \\dfrac{d}{dx}\\cos^{-1}x = -\\dfrac{1}{\\sqrt{1 - x^2}}',
        '\\dfrac{d}{dx}\\tan^{-1}x = \\dfrac{1}{1 + x^2} \\qquad \\dfrac{d}{dx}\\cot^{-1}x = -\\dfrac{1}{1 + x^2}',
        '\\dfrac{d}{dx}\\sec^{-1}x = \\dfrac{1}{|x|\\sqrt{x^2 - 1}} \\qquad \\dfrac{d}{dx}\\csc^{-1}x = -\\dfrac{1}{|x|\\sqrt{x^2 - 1}}',
      ],
      'arcsin arctan',
    ),
    f(
      'derivative-rules',
      'Product, quotient and chain rules',
      [
        "(uv)' = u'v + uv'",
        "\\left(\\dfrac{u}{v}\\right)' = \\dfrac{u'v - uv'}{v^2}",
        '\\dfrac{dy}{dx} = \\dfrac{dy}{du} \\cdot \\dfrac{du}{dx}',
      ],
      'product quotient chain rule',
    ),
    f(
      'parametric',
      'Parametric and implicit',
      [
        '\\dfrac{dy}{dx} = \\dfrac{dy/dt}{dx/dt}',
        'F(x, y) = 0 \\;\\Rightarrow\\; \\dfrac{dy}{dx} = -\\dfrac{\\partial F/\\partial x}{\\partial F/\\partial y}',
      ],
      'implicit differentiation',
    ),
    f(
      'tangent-normal',
      'Tangent and normal',
      [
        "\\text{Tangent: } y - y_1 = f'(x_1)(x - x_1)",
        "\\text{Normal: } y - y_1 = -\\dfrac{1}{f'(x_1)}(x - x_1)",
      ],
      'slope line',
    ),
    f(
      'maxima-minima',
      'Maxima and minima',
      [
        "f'(x) > 0 \\Rightarrow \\text{increasing} \\qquad f'(x) < 0 \\Rightarrow \\text{decreasing}",
        "f'(c) = 0,\\; f''(c) < 0 \\Rightarrow \\text{local max} \\qquad f'(c) = 0,\\; f''(c) > 0 \\Rightarrow \\text{local min}",
      ],
      'second derivative test optimisation',
    ),
    f(
      'maclaurin',
      'Taylor and Maclaurin series',
      [
        'f(x) = \\sum_{n=0}^{\\infty} \\dfrac{f^{(n)}(a)}{n!}(x - a)^n',
        'e^x = 1 + x + \\dfrac{x^2}{2!} + \\dfrac{x^3}{3!} + \\cdots',
        '\\sin x = x - \\dfrac{x^3}{3!} + \\dfrac{x^5}{5!} - \\cdots \\qquad \\cos x = 1 - \\dfrac{x^2}{2!} + \\dfrac{x^4}{4!} - \\cdots',
        '\\ln(1 + x) = x - \\dfrac{x^2}{2} + \\dfrac{x^3}{3} - \\cdots \\quad (-1 < x \\le 1)',
      ],
      'expansion series',
    ),
  ],
};

export const integration = {
  id: 'integral-calculus',
  title: 'Integral calculus',
  subject: 'Maths',
  description:
    'Standard integrals, substitution, integration by parts, and definite-integral properties.',
  glyph: '∫',
  color: '#e8590c',
  items: [
    f(
      'basic-integrals',
      'Standard integrals',
      [
        '\\int x^n\\,dx = \\dfrac{x^{n+1}}{n+1} + C \\;\\; (n \\ne -1) \\qquad \\int \\dfrac{1}{x}\\,dx = \\ln|x| + C',
        '\\int e^x\\,dx = e^x + C \\qquad \\int a^x\\,dx = \\dfrac{a^x}{\\ln a} + C',
      ],
      'power exponential',
    ),
    f(
      'trig-integrals',
      'Integrals of trig functions',
      [
        '\\int \\sin x\\,dx = -\\cos x + C \\qquad \\int \\cos x\\,dx = \\sin x + C',
        '\\int \\sec^2 x\\,dx = \\tan x + C \\qquad \\int \\csc^2 x\\,dx = -\\cot x + C',
        '\\int \\sec x\\tan x\\,dx = \\sec x + C \\qquad \\int \\csc x\\cot x\\,dx = -\\csc x + C',
      ],
      'sin cos integral',
    ),
    f(
      'more-trig-integrals',
      'More trig integrals',
      [
        '\\int \\tan x\\,dx = \\ln|\\sec x| + C \\qquad \\int \\cot x\\,dx = \\ln|\\sin x| + C',
        '\\int \\sec x\\,dx = \\ln|\\sec x + \\tan x| + C \\qquad \\int \\csc x\\,dx = \\ln|\\csc x - \\cot x| + C',
      ],
      'tan sec integral',
    ),
    f(
      'standard-forms',
      'Standard forms',
      [
        '\\int \\dfrac{dx}{x^2 + a^2} = \\dfrac{1}{a}\\tan^{-1}\\dfrac{x}{a} + C \\qquad \\int \\dfrac{dx}{\\sqrt{a^2 - x^2}} = \\sin^{-1}\\dfrac{x}{a} + C',
        '\\int \\dfrac{dx}{x^2 - a^2} = \\dfrac{1}{2a}\\ln\\left|\\dfrac{x - a}{x + a}\\right| + C \\qquad \\int \\dfrac{dx}{a^2 - x^2} = \\dfrac{1}{2a}\\ln\\left|\\dfrac{a + x}{a - x}\\right| + C',
        '\\int \\dfrac{dx}{\\sqrt{x^2 + a^2}} = \\ln\\left|x + \\sqrt{x^2 + a^2}\\right| + C \\qquad \\int \\dfrac{dx}{\\sqrt{x^2 - a^2}} = \\ln\\left|x + \\sqrt{x^2 - a^2}\\right| + C',
      ],
      'inverse trig log forms',
    ),
    f(
      'root-forms',
      'Square-root forms',
      [
        '\\int \\sqrt{a^2 - x^2}\\,dx = \\dfrac{x}{2}\\sqrt{a^2 - x^2} + \\dfrac{a^2}{2}\\sin^{-1}\\dfrac{x}{a} + C',
        '\\int \\sqrt{x^2 + a^2}\\,dx = \\dfrac{x}{2}\\sqrt{x^2 + a^2} + \\dfrac{a^2}{2}\\ln\\left|x + \\sqrt{x^2 + a^2}\\right| + C',
        '\\int \\sqrt{x^2 - a^2}\\,dx = \\dfrac{x}{2}\\sqrt{x^2 - a^2} - \\dfrac{a^2}{2}\\ln\\left|x + \\sqrt{x^2 - a^2}\\right| + C',
      ],
      'sqrt integral',
    ),
    f(
      'by-parts',
      'Integration by parts',
      [
        '\\int u\\,dv = uv - \\int v\\,du',
        '\\text{Choose } u \\text{ by ILATE: Inverse trig, Log, Algebraic, Trig, Exponential}',
      ],
      'ILATE parts',
    ),
    f(
      'substitution',
      'Substitution',
      [
        "\\int f\\big(g(x)\\big)\\,g'(x)\\,dx = \\int f(u)\\,du, \\quad u = g(x)",
        "\\int \\dfrac{f'(x)}{f(x)}\\,dx = \\ln|f(x)| + C \\qquad \\int e^x\\big(f(x) + f'(x)\\big)\\,dx = e^x f(x) + C",
      ],
      'u substitution',
    ),
    f(
      'definite-properties',
      'Properties of definite integrals',
      [
        '\\int_a^b f(x)\\,dx = F(b) - F(a) \\qquad \\int_a^b f(x)\\,dx = -\\int_b^a f(x)\\,dx',
        '\\int_a^b f(x)\\,dx = \\int_a^c f(x)\\,dx + \\int_c^b f(x)\\,dx',
        '\\int_a^b f(x)\\,dx = \\int_a^b f(a + b - x)\\,dx \\qquad \\int_0^a f(x)\\,dx = \\int_0^a f(a - x)\\,dx',
        '\\int_{-a}^{a} f(x)\\,dx = \\begin{cases} 2\\int_0^a f(x)\\,dx & f \\text{ even} \\\\ 0 & f \\text{ odd} \\end{cases}',
      ],
      'definite integral limits',
    ),
    f(
      'area',
      'Area under and between curves',
      [
        'A = \\int_a^b |f(x)|\\,dx',
        'A = \\int_a^b \\big(f(x) - g(x)\\big)\\,dx \\quad \\text{where } f(x) \\ge g(x)',
      ],
      'area region',
    ),
  ],
};

export const differentialEquations = {
  id: 'differential-equations',
  title: 'Differential equations',
  subject: 'Maths',
  description:
    'Separable, linear, homogeneous and exact first-order equations, plus second-order solutions.',
  glyph: "y'",
  color: '#0b7285',
  items: [
    f(
      'separable',
      'Variables separable',
      [
        '\\dfrac{dy}{dx} = g(x)\\,h(y) \\;\\Rightarrow\\; \\int \\dfrac{dy}{h(y)} = \\int g(x)\\,dx + C',
      ],
      'separation of variables',
    ),
    f(
      'linear-first-order',
      'First-order linear',
      [
        '\\dfrac{dy}{dx} + P(x)\\,y = Q(x)',
        '\\text{IF} = e^{\\int P(x)\\,dx} \\qquad y \\cdot \\text{IF} = \\int Q(x) \\cdot \\text{IF}\\,dx + C',
      ],
      'integrating factor',
    ),
    f(
      'homogeneous',
      'Homogeneous equations',
      [
        '\\dfrac{dy}{dx} = F\\!\\left(\\dfrac{y}{x}\\right), \\quad y = vx \\;\\Rightarrow\\; v + x\\dfrac{dv}{dx} = F(v)',
      ],
      'substitution y=vx',
    ),
    f(
      'exact',
      'Exact equations',
      [
        'M\\,dx + N\\,dy = 0 \\text{ is exact when } \\dfrac{\\partial M}{\\partial y} = \\dfrac{\\partial N}{\\partial x}',
      ],
      'exact differential',
    ),
    f('bernoulli', 'Bernoulli equation', [
      '\\dfrac{dy}{dx} + P(x)\\,y = Q(x)\\,y^n, \\quad v = y^{1-n} \\;\\Rightarrow\\; \\dfrac{dv}{dx} + (1 - n)P\\,v = (1 - n)Q',
    ]),
    f(
      'second-order',
      'Second order, constant coefficients',
      [
        "ay'' + by' + cy = 0, \\quad ar^2 + br + c = 0",
        'r_1 \\ne r_2 \\text{ real: } y = C_1 e^{r_1 x} + C_2 e^{r_2 x}',
        'r_1 = r_2 = r: \\; y = (C_1 + C_2 x)\\,e^{rx}',
        'r = \\alpha \\pm i\\beta: \\; y = e^{\\alpha x}(C_1\\cos\\beta x + C_2\\sin\\beta x)',
      ],
      'characteristic auxiliary equation',
    ),
    f(
      'growth-decay',
      'Growth and decay',
      [
        '\\dfrac{dN}{dt} = kN \\;\\Rightarrow\\; N = N_0\\,e^{kt}',
        '\\text{Half-life: } t_{1/2} = \\dfrac{\\ln 2}{|k|}',
      ],
      'exponential radioactive population',
    ),
  ],
};

export const statistics = {
  id: 'statistics',
  title: 'Statistics & probability',
  subject: 'Maths',
  description:
    'Averages, spread, probability rules, Bayes, and the binomial and normal distributions.',
  glyph: 'σ',
  color: '#c2255c',
  items: [
    f(
      'averages',
      'Mean, median, mode',
      [
        '\\bar{x} = \\dfrac{\\sum x_i}{n} \\qquad \\bar{x} = \\dfrac{\\sum f_i x_i}{\\sum f_i}',
        '\\text{Median: middle value of the ordered data} \\qquad \\text{Mode: most frequent value}',
      ],
      'average central tendency',
    ),
    f(
      'spread',
      'Variance and standard deviation',
      [
        '\\sigma^2 = \\dfrac{\\sum (x_i - \\bar{x})^2}{n} = \\dfrac{\\sum x_i^2}{n} - \\bar{x}^2',
        '\\sigma = \\sqrt{\\sigma^2} \\qquad s^2 = \\dfrac{\\sum (x_i - \\bar{x})^2}{n - 1} \\;\\; \\text{(sample)}',
      ],
      'dispersion',
    ),
    f(
      'probability-rules',
      'Probability rules',
      [
        'P(A \\cup B) = P(A) + P(B) - P(A \\cap B) \\qquad P(A^c) = 1 - P(A)',
        'P(A \\mid B) = \\dfrac{P(A \\cap B)}{P(B)} \\qquad \\text{Independent: } P(A \\cap B) = P(A)\\,P(B)',
      ],
      'conditional union',
    ),
    f(
      'bayes',
      "Bayes' theorem",
      ['P(A \\mid B) = \\dfrac{P(B \\mid A)\\,P(A)}{P(B)}'],
      'conditional probability',
    ),
    f(
      'binomial-distribution',
      'Binomial distribution',
      [
        'P(X = r) = \\binom{n}{r} p^r q^{\\,n-r}, \\quad q = 1 - p',
        '\\mu = np \\qquad \\sigma^2 = npq',
      ],
      'binomial mean variance',
    ),
    f(
      'normal-distribution',
      'Normal distribution',
      [
        'z = \\dfrac{x - \\mu}{\\sigma}',
        '\\text{About } 68\\%,\\ 95\\%,\\ 99.7\\% \\text{ of values lie within } 1, 2, 3\\,\\sigma \\text{ of } \\mu',
      ],
      'z score bell curve',
    ),
  ],
};
