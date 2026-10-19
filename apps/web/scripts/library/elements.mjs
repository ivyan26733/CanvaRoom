// The 118 elements: atomic number, symbol, name, standard atomic weight
// (abridged; [n] is the mass number of the most stable isotope), category.

const RAW = `1 H Hydrogen 1.008 nonmetal
2 He Helium 4.0026 noble
3 Li Lithium 6.94 alkali
4 Be Beryllium 9.0122 alkaline
5 B Boron 10.81 metalloid
6 C Carbon 12.011 nonmetal
7 N Nitrogen 14.007 nonmetal
8 O Oxygen 15.999 nonmetal
9 F Fluorine 18.998 halogen
10 Ne Neon 20.180 noble
11 Na Sodium 22.990 alkali
12 Mg Magnesium 24.305 alkaline
13 Al Aluminium 26.982 post
14 Si Silicon 28.085 metalloid
15 P Phosphorus 30.974 nonmetal
16 S Sulfur 32.06 nonmetal
17 Cl Chlorine 35.45 halogen
18 Ar Argon 39.95 noble
19 K Potassium 39.098 alkali
20 Ca Calcium 40.078 alkaline
21 Sc Scandium 44.956 transition
22 Ti Titanium 47.867 transition
23 V Vanadium 50.942 transition
24 Cr Chromium 51.996 transition
25 Mn Manganese 54.938 transition
26 Fe Iron 55.845 transition
27 Co Cobalt 58.933 transition
28 Ni Nickel 58.693 transition
29 Cu Copper 63.546 transition
30 Zn Zinc 65.38 transition
31 Ga Gallium 69.723 post
32 Ge Germanium 72.630 metalloid
33 As Arsenic 74.922 metalloid
34 Se Selenium 78.971 nonmetal
35 Br Bromine 79.904 halogen
36 Kr Krypton 83.798 noble
37 Rb Rubidium 85.468 alkali
38 Sr Strontium 87.62 alkaline
39 Y Yttrium 88.906 transition
40 Zr Zirconium 91.224 transition
41 Nb Niobium 92.906 transition
42 Mo Molybdenum 95.95 transition
43 Tc Technetium [98] transition
44 Ru Ruthenium 101.07 transition
45 Rh Rhodium 102.91 transition
46 Pd Palladium 106.42 transition
47 Ag Silver 107.87 transition
48 Cd Cadmium 112.41 transition
49 In Indium 114.82 post
50 Sn Tin 118.71 post
51 Sb Antimony 121.76 metalloid
52 Te Tellurium 127.60 metalloid
53 I Iodine 126.90 halogen
54 Xe Xenon 131.29 noble
55 Cs Caesium 132.91 alkali
56 Ba Barium 137.33 alkaline
57 La Lanthanum 138.91 lanthanide
58 Ce Cerium 140.12 lanthanide
59 Pr Praseodymium 140.91 lanthanide
60 Nd Neodymium 144.24 lanthanide
61 Pm Promethium [145] lanthanide
62 Sm Samarium 150.36 lanthanide
63 Eu Europium 151.96 lanthanide
64 Gd Gadolinium 157.25 lanthanide
65 Tb Terbium 158.93 lanthanide
66 Dy Dysprosium 162.50 lanthanide
67 Ho Holmium 164.93 lanthanide
68 Er Erbium 167.26 lanthanide
69 Tm Thulium 168.93 lanthanide
70 Yb Ytterbium 173.05 lanthanide
71 Lu Lutetium 174.97 lanthanide
72 Hf Hafnium 178.49 transition
73 Ta Tantalum 180.95 transition
74 W Tungsten 183.84 transition
75 Re Rhenium 186.21 transition
76 Os Osmium 190.23 transition
77 Ir Iridium 192.22 transition
78 Pt Platinum 195.08 transition
79 Au Gold 196.97 transition
80 Hg Mercury 200.59 transition
81 Tl Thallium 204.38 post
82 Pb Lead 207.2 post
83 Bi Bismuth 208.98 post
84 Po Polonium [209] post
85 At Astatine [210] halogen
86 Rn Radon [222] noble
87 Fr Francium [223] alkali
88 Ra Radium [226] alkaline
89 Ac Actinium [227] actinide
90 Th Thorium 232.04 actinide
91 Pa Protactinium 231.04 actinide
92 U Uranium 238.03 actinide
93 Np Neptunium [237] actinide
94 Pu Plutonium [244] actinide
95 Am Americium [243] actinide
96 Cm Curium [247] actinide
97 Bk Berkelium [247] actinide
98 Cf Californium [251] actinide
99 Es Einsteinium [252] actinide
100 Fm Fermium [257] actinide
101 Md Mendelevium [258] actinide
102 No Nobelium [259] actinide
103 Lr Lawrencium [266] actinide
104 Rf Rutherfordium [267] transition
105 Db Dubnium [268] transition
106 Sg Seaborgium [269] transition
107 Bh Bohrium [270] transition
108 Hs Hassium [269] transition
109 Mt Meitnerium [278] unknown
110 Ds Darmstadtium [281] unknown
111 Rg Roentgenium [282] unknown
112 Cn Copernicium [285] unknown
113 Nh Nihonium [286] unknown
114 Fl Flerovium [289] unknown
115 Mc Moscovium [290] unknown
116 Lv Livermorium [293] unknown
117 Ts Tennessine [294] unknown
118 Og Oganesson [294] unknown`;

export const CATEGORIES = {
  alkali: { label: 'Alkali metal', fill: '#ffd8a8' },
  alkaline: { label: 'Alkaline earth metal', fill: '#ffec99' },
  transition: { label: 'Transition metal', fill: '#ffc9c9' },
  post: { label: 'Post-transition metal', fill: '#d0ebff' },
  metalloid: { label: 'Metalloid', fill: '#c3fae8' },
  nonmetal: { label: 'Reactive nonmetal', fill: '#d3f9d8' },
  halogen: { label: 'Halogen', fill: '#e9fac8' },
  noble: { label: 'Noble gas', fill: '#e5dbff' },
  lanthanide: { label: 'Lanthanide', fill: '#fcc2d7' },
  actinide: { label: 'Actinide', fill: '#eebefa' },
  unknown: { label: 'Unknown properties', fill: '#e9ecef' },
};

export const ELEMENTS = RAW.split('\n').map((line) => {
  const [number, symbol, name, mass, category] = line.trim().split(' ');
  return { number: Number(number), symbol, name, mass, category };
});

/** Row and column on the standard 18-column layout; f-block rows sit below. */
export function position(number) {
  if (number === 1) return { row: 1, col: 1 };
  if (number === 2) return { row: 1, col: 18 };
  if (number <= 10)
    return { row: 2, col: number <= 4 ? number - 2 : number + 8 };
  if (number <= 18) return { row: 3, col: number <= 12 ? number - 10 : number };
  if (number <= 36) return { row: 4, col: number - 18 };
  if (number <= 54) return { row: 5, col: number - 36 };
  if (number >= 57 && number <= 71) return { row: 9, col: number - 54 };
  if (number >= 89 && number <= 103) return { row: 10, col: number - 86 };
  if (number <= 86)
    return { row: 6, col: number <= 56 ? number - 54 : number - 68 };
  return { row: 7, col: number <= 88 ? number - 86 : number - 100 };
}
